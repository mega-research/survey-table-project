import 'server-only';

import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveys, teamLifecycleEvents, teamMembers, teams, users } from '@/db/schema';
import { isUniqueViolation } from '@/lib/pg-error';
import { canManageTeamMembers, canManageTeamSettings } from '@/shared/contracts/workspace';

import {
  DuplicateTeamNameError,
  TeamNotFoundError,
  type CreateTeamInput,
  type CreateTeamOutput,
  type ListMyTeamsOutput,
  type ListTeamsOutput,
  type RenameTeamInput,
  type TeamDetailOutput,
  type WorkspaceActionOutput,
} from '../domain/teams';
import { getActiveTeamMemberships } from './memberships';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 설문이 팀에 귀속되기 전까지의 팀별 설문 수.
 *
 * surveys.team_id 는 티켓 07 이 만든다. 그때까지 어떤 설문도 팀 소유가 아니므로 0 이
 * 사실이다 — 07 이 이 함수를 실제 집계로 바꾸면 화면·계약은 그대로 둔 채 값만 살아난다.
 */
function teamSurveyCount(): number {
  return 0;
}

/**
 * 팀 관리 목록 (.pen FLOW 7-1) — 활성 팀 + 메가리서치 카드 지표.
 *
 * 「메가리서치」는 팀이 아니라 시스템 전체 보기라 teams 행이 없다(ADR-0006). 카드에 쓰는
 * 팀 수·전체 설문 수를 목록과 함께 돌려주는 이유가 그것이다.
 */
export async function listTeams(): Promise<ListTeamsOutput> {
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      memberCount: sql<number>`count(${teamMembers.id})::int`,
    })
    .from(teams)
    .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(eq(teams.status, 'active'))
    .groupBy(teams.id)
    .orderBy(asc(teams.order), asc(teams.name));

  const [surveyTotal] = await db
    .select({ value: count() })
    .from(surveys)
    .where(isNull(surveys.deletedAt));

  return {
    teams: rows.map((row) => ({ ...row, surveyCount: teamSurveyCount() })),
    systemSummary: { teamCount: rows.length, surveyCount: surveyTotal?.value ?? 0 },
  };
}

/** 내가 속한 활성 팀 — 팀 스위처·팀 상세 진입(티켓 08)이 쓴다. */
export async function listMyTeams(userId: string): Promise<ListMyTeamsOutput> {
  const memberships = await getActiveTeamMemberships(userId);
  return memberships.map((m) => ({ teamId: m.teamId, teamName: m.teamName, role: m.role }));
}

/**
 * 팀 생성 (슈퍼어드민).
 *
 * order 는 만든 순서다 — 목록 정렬용 자리이고 지금은 드래그 정렬 화면이 없다(.pen 7-1).
 * 이름 충돌은 활성 팀 부분 UNIQUE 가 잡는다(archived 이름은 다시 쓸 수 있다).
 */
export async function createTeam(
  actorUserId: string,
  input: CreateTeamInput,
): Promise<CreateTeamOutput> {
  try {
    return await db.transaction(async (tx) => {
      const [maxOrder] = await tx
        .select({ value: sql<number>`coalesce(max(${teams.order}), -1)::int` })
        .from(teams)
        .where(eq(teams.status, 'active'));

      const [team] = await tx
        .insert(teams)
        .values({
          name: input.name,
          description: input.description ?? null,
          order: (maxOrder?.value ?? -1) + 1,
        })
        .returning({ id: teams.id, name: teams.name });
      if (!team) throw new Error('createTeam: 팀 생성 실패');

      await tx.insert(teamLifecycleEvents).values({
        teamId: team.id,
        action: 'create',
        changedBy: actorUserId,
        metadata: { teamName: team.name },
      });

      return { id: team.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateTeamNameError();
    throw err;
  }
}

/**
 * 팀 이름·설명 수정 (슈퍼어드민).
 *
 * 이름은 전체 조직 경로라 바뀌면 조직도가 바뀐 것이다 — 감사에 이전 이름을 함께 남긴다.
 * 해산된 팀은 대상이 아니다(status='active' 조건).
 */
export async function renameTeam(
  actorUserId: string,
  input: RenameTeamInput,
): Promise<WorkspaceActionOutput> {
  try {
    return await db.transaction(async (tx) => {
      const before = await tx.query.teams.findFirst({
        where: and(eq(teams.id, input.teamId), eq(teams.status, 'active')),
        columns: { id: true, name: true },
      });
      if (!before) throw new TeamNotFoundError();

      await tx
        .update(teams)
        .set({
          name: input.name,
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedAt: new Date(),
        })
        .where(eq(teams.id, before.id));

      // 이름이 그대로면(설명만 고침) 감사 행을 남기지 않는다 — 조직도는 바뀌지 않았다.
      if (before.name !== input.name) {
        await tx.insert(teamLifecycleEvents).values({
          teamId: before.id,
          action: 'rename',
          changedBy: actorUserId,
          metadata: { teamName: input.name, previousName: before.name },
        });
      }

      return OK;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateTeamNameError();
    throw err;
  }
}

/**
 * 팀 상세 (.pen FLOW 7-2) — 멤버 표 + 요청자의 관리 권한.
 *
 * 접근은 슈퍼어드민이거나 그 팀 소속이어야 한다. 소속이 아닌 사람에게 팀 이름·멤버 명단을
 * 보여줄 이유가 없다 — 팀은 독립 접근 단위다(ADR-0008).
 */
export async function getTeamDetail(
  actor: { id: string; isSuperadmin: boolean },
  teamId: string,
): Promise<TeamDetailOutput> {
  const team = await db.query.teams.findFirst({
    where: and(eq(teams.id, teamId), eq(teams.status, 'active')),
    columns: { id: true, name: true, description: true },
  });
  if (!team) throw new TeamNotFoundError();

  const myRole = actor.isSuperadmin
    ? null
    : ((await getActiveTeamMemberships(actor.id)).find((m) => m.teamId === teamId)?.role ?? null);
  if (!actor.isSuperadmin && myRole === null) {
    // 존재를 알려주지 않는다 — 남의 팀 id 를 찍어보는 것과 없는 팀을 찍어보는 것이 같은 답을 받는다.
    throw new TeamNotFoundError();
  }

  // 겸직 표기(.pen 7-2 「· 2팀 겸직」)용 — 이 팀을 뺀 다른 활성 팀 소속 수.
  const otherTeams = db
    .select({ userId: teamMembers.userId, value: count().as('value') })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teams.status, 'active'), ne(teamMembers.teamId, teamId)))
    .groupBy(teamMembers.userId)
    .as('other_teams');

  const members = await db
    .select({
      userId: teamMembers.userId,
      name: users.name,
      email: users.email,
      jobTitle: users.jobTitle,
      role: teamMembers.role,
      status: users.status,
      otherTeamCount: sql<number>`coalesce(${otherTeams.value}, 0)::int`,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .leftJoin(otherTeams, eq(otherTeams.userId, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId))
    // 팀장을 위에 세운다 — 표의 첫 줄이 누구에게 물어야 하는지를 알려준다.
    .orderBy(asc(teamMembers.role), asc(users.name));

  return {
    ...team,
    memberCount: members.length,
    surveyCount: teamSurveyCount(),
    members,
    canManageMembers: canManageTeamMembers(actor, myRole),
    canManageSettings: canManageTeamSettings(actor),
  };
}
