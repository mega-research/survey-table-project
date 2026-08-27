import 'server-only';

import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveys, teamLifecycleEvents, teamMembers, teams, users } from '@/db/schema';
import { isUniqueViolation } from '@/lib/pg-error';
import { canManageTeamMembers, canManageTeamSettings } from '@/shared/contracts/workspace';

import {
  DuplicateTeamNameError,
  TeamNameMismatchError,
  TeamNotFoundError,
  type CreateTeamInput,
  type CreateTeamOutput,
  type DissolveTeamInput,
  type ListTeamsOutput,
  type RenameTeamInput,
  type TeamDetailOutput,
  type WorkspaceActionOutput,
} from '../domain/teams';
import { lockTeamMembers } from './members';
import { getTeamRole } from '@/server/read-models/team-memberships';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 팀 관리 목록 (.pen FLOW 7-1) — 활성 팀 + 메가리서치 카드 지표.
 *
 * 「메가리서치」는 팀이 아니라 시스템 전체 보기라 teams 행이 없다(ADR-0006). 카드에 쓰는
 * 팀 수·전체 설문 수를 목록과 함께 돌려주는 이유가 그것이다.
 */
export async function listTeams(): Promise<ListTeamsOutput> {
  // 멤버 수와 설문 수를 한 쿼리에서 세면 조인이 곱해져 양쪽이 부풀어 오른다 — 팀별
  // 설문 수는 따로 집계해 붙인다(티켓 07 이 surveys.team_id 를 만들면서 살아난 값이다).
  const [rows, surveyRows, surveyTotalRows] = await Promise.all([
    db
      .select({
        id: teams.id,
        name: teams.name,
        memberCount: sql<number>`count(${teamMembers.id})::int`,
      })
      .from(teams)
      .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .where(eq(teams.status, 'active'))
      .groupBy(teams.id)
      .orderBy(asc(teams.order), asc(teams.name)),
    db
      .select({ teamId: surveys.teamId, value: count() })
      .from(surveys)
      .where(isNull(surveys.deletedAt))
      .groupBy(surveys.teamId),
    db.select({ value: count() }).from(surveys).where(isNull(surveys.deletedAt)),
  ]);

  const surveyCountByTeam = new Map(
    surveyRows.filter((r) => r.teamId !== null).map((r) => [r.teamId as string, r.value]),
  );

  return {
    teams: rows.map((row) => ({ ...row, surveyCount: surveyCountByTeam.get(row.id) ?? 0 })),
    // 메가리서치 카드의 설문 수는 배치 대기까지 포함한 전체다 — 시스템 전체 보기가
    // 실제로 반환하는 범위와 같은 수여야 한다.
    systemSummary: { teamCount: rows.length, surveyCount: surveyTotalRows[0]?.value ?? 0 },
  };
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
        .values({ name: input.name, order: (maxOrder?.value ?? -1) + 1 })
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
 * 팀 이름 수정 (슈퍼어드민).
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

      // 이름이 그대로면 아무 일도 하지 않는다 — 조직도는 바뀌지 않았고 감사에 남길 것도 없다.
      if (before.name === input.name) return OK;

      // WHERE 에 status 를 함께 건다 — 해산된 팀의 이름은 감사 기록이다. 조건이 없으면
      // before 를 active 로 읽은 뒤 dissolve 가 커밋되는 창에서 archived 팀의 이름을 바꾸고,
      // dissolve 이벤트 **뒤에** rename 감사 행을 남긴다(ADR-0011 이 행을 남기는 이유와 어긋난다).
      const [renamed] = await tx
        .update(teams)
        .set({ name: input.name, updatedAt: new Date() })
        .where(and(eq(teams.id, before.id), eq(teams.status, 'active')))
        .returning({ id: teams.id });
      if (!renamed) throw new TeamNotFoundError();

      await tx.insert(teamLifecycleEvents).values({
        teamId: before.id,
        action: 'rename',
        changedBy: actorUserId,
        metadata: { teamName: input.name, previousName: before.name },
      });

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
 * 여는 사람은 **슈퍼어드민 또는 그 팀 팀장**이다(.pen 7-2 컬럼 머리). 이 화면은 명단·이메일·
 * 겸직 수를 그대로 펼치는 관리 화면이라 팀원에게까지 열 이유가 지금은 없다 — 필요해지면
 * 그때 여는 편이, 열어둔 것을 뒤늦게 좁히는 것보다 낫다.
 */
export async function getTeamDetail(
  actor: { id: string; isSuperadmin: boolean },
  teamId: string,
): Promise<TeamDetailOutput> {
  const team = await db.query.teams.findFirst({
    where: and(eq(teams.id, teamId), eq(teams.status, 'active')),
    columns: { id: true, name: true },
  });
  if (!team) throw new TeamNotFoundError();

  const myRole = actor.isSuperadmin ? null : await getTeamRole(actor.id, teamId);
  if (!canManageTeamMembers(actor, myRole)) {
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
    // 역할 문자열의 사전순에 기대지 않는다: 값이 하나만 늘어도 조용히 순서가 뒤집힌다.
    .orderBy(sql`case when ${teamMembers.role} = 'leader' then 0 else 1 end`, asc(users.name));

  const [teamSurveys] = await db
    .select({ value: count() })
    .from(surveys)
    .where(and(eq(surveys.teamId, teamId), isNull(surveys.deletedAt)));

  return {
    ...team,
    memberCount: members.length,
    surveyCount: teamSurveys?.value ?? 0,
    members,
    canManageMembers: canManageTeamMembers(actor, myRole),
    canManageSettings: canManageTeamSettings(actor),
  };
}

/**
 * 팀 해산 — 확정 즉시, 한 트랜잭션 (ADR-0011, .pen FLOW 8-1).
 *
 * 세 가지가 함께 일어난다.
 *  1. 팀이 `archived` 로 바뀐다. **행을 지우지 않는다** — 감사 계보와 「해산 시점 명부」가
 *     거기 걸려 있다.
 *  2. 소속 설문이 전부 배치 대기가 된다(`teamId=null` + `assignmentStatus='assignment_pending'`).
 *     DB CHECK 가 둘을 한 몸으로 묶으므로 같은 SET 절에서 바꿔야 한다. `surveyGroupId` 도
 *     함께 내린다 — 그룹은 팀 소유물이라 팀을 잃은 설문이 남의 팀 폴더에 남으면 안 된다
 *     (0090 마이그레이션 헤더의 계약).
 *  3. 감사 행 하나. 규모(팀원 수·설문 수)는 **트랜잭션 안에서 잰 값**이다 — 화면이 모달에
 *     보여준 숫자는 그 사이 바뀔 수 있고, 설문은 teamId 를 잃어 사후에 되짚을 수 없다.
 *
 * `team_members` 행은 건드리지 않는다. 유효 소속 판정의 SSOT 인 `getActiveTeamMemberships`
 * 가 active 팀만 조인하므로, 팀이 archived 가 되는 순간 팀원 전원이 자동으로 미배치가 된다
 * (ADR-0011). 행을 지우면 명부가 사라지고, 남기려면 멤버 수만큼 감사 행을 따로 써야 한다.
 *
 * **해산 취소는 없다.** 이 함수의 짝이 되는 복구 함수를 만들지 말 것 — 되돌리기가 있으면
 * 확인 모달의 "되돌릴 수 없습니다" 가 거짓이 되고, 재배치(티켓 14)가 이미 정식 복구 경로다.
 *
 * 동시성: 팀 키 advisory lock 으로 직렬화하고, 최종 UPDATE 도 `status='active'` 를 조건에
 * 넣어 0행이면 던진다. 잠금만으로는 부족하다 — 앞선 트랜잭션이 이미 해산한 뒤에 락을 받으면
 * 두 번째 해산이 감사 행을 하나 더 쓰고 archivedBy 를 덮는다. 키는 멤버 변경과 **같은 것**을
 * 쓴다(members 의 lockTeamMembers): 해산은 멤버십의 유효성을 통째로 끊는 일이라 같은 축의
 * 경합이고, 키가 갈리면 해산 직전에 들어온 멤버가 archived 팀의 유령 행으로 남는다.
 */
export async function dissolveTeam(
  actorUserId: string,
  input: DissolveTeamInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    await lockTeamMembers(tx, input.teamId);

    // **팀 행을 먼저 잠근다.** 이름 대조도 잠긴 값으로 해야 한다 — 잠그지 않으면 이름을 읽어
    // 확인란과 맞춘 뒤 다른 슈퍼어드민의 renameTeam 이 끼어들어, 확인한 적 없는 이름의 팀이
    // 해산되고 감사에는 옛 이름이 박힌다.
    const [team] = await tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.id, input.teamId), eq(teams.status, 'active')))
      .for('update');
    if (!team) throw new TeamNotFoundError();
    // 확인란 대조는 서버에도 있어야 한다 — 화면만 검사하면 raw RPC 로 우회된다.
    if (team.name !== input.confirmName.trim()) throw new TeamNameMismatchError();

    const [memberRow] = await tx
      .select({ value: count() })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, team.id));

    // **팀을 먼저 archived 로 바꾼다.** 설문을 먼저 옮기면 두 UPDATE 사이에 커밋되는 설문
    // 생성이 구제되지 않는다 — 생성 경로는 팀 행에 FOR SHARE 를 잡으므로(surveys 서비스의
    // resolveNewSurveyOwnership), 팀이 잠긴 뒤에는 그 트랜잭션이 대기하다 archived 를 보고
    // 거부된다. 순서를 뒤집으면 그 보호가 통째로 무의미해진다.
    const [archived] = await tx
      .update(teams)
      .set({
        status: 'archived',
        archivedBy: actorUserId,
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(teams.id, team.id), eq(teams.status, 'active')))
      .returning({ id: teams.id });
    if (!archived) throw new TeamNotFoundError();

    // 설문 행은 **id 오름차순으로 잠근다.** 「설문 담기」가 같은 순서로 잠그기 때문이다
    // (survey-groups 의 collectSurveysIntoGroup). UPDATE 한 문장으로 두면 잠금 순서가 실행
    // 계획(team_id 인덱스 → 힙 순서)에 달려 담기와 사이클을 만들고, 40P01 은 도메인 에러가
    // 아니라 500 으로 샌다.
    //
    // `deletedAt` 으로 좁히지 않는다. 삭제된 설문을 남겨두면 archived 팀을 가리킨 채
    // `assigned` 로 굳어, 복구 동선(티켓 17)이 열리는 순간 없는 팀 소속으로 부활하고
    // 재배치 큐(assignment_pending 기준)에도 안 잡힌다. 감사에 적는 수만 살아 있는 행으로 센다.
    const targets = await tx
      .select({ id: surveys.id, deletedAt: surveys.deletedAt })
      .from(surveys)
      .where(eq(surveys.teamId, team.id))
      .orderBy(asc(surveys.id))
      .for('update');

    if (targets.length > 0) {
      await tx
        .update(surveys)
        .set({
          teamId: null,
          assignmentStatus: 'assignment_pending',
          surveyGroupId: null,
          updatedAt: new Date(),
        })
        .where(
          inArray(
            surveys.id,
            targets.map((t) => t.id),
          ),
        );
    }

    await tx.insert(teamLifecycleEvents).values({
      teamId: team.id,
      action: 'dissolve',
      changedBy: actorUserId,
      metadata: {
        teamName: team.name,
        memberCount: memberRow?.value ?? 0,
        // 화면(listTeams·getTeamDetail)이 보여준 숫자와 같은 모집단이어야 한다.
        surveyCount: targets.filter((t) => t.deletedAt === null).length,
      },
    });

    return OK;
  });
}
