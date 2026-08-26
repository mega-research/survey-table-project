import 'server-only';

import { and, asc, count, eq, ilike, notExists, or, sql } from 'drizzle-orm';

import { type DbTransaction, db } from '@/db';
import { teamMembers, teams, users } from '@/db/schema';
import { isUniqueViolation } from '@/lib/pg-error';

import {
  AlreadyTeamMemberError,
  TargetUserNotFoundError,
  TeamMemberNotFoundError,
  TeamNotFoundError,
  assertLastLeaderKept,
  assertMemberAssignable,
  type AddTeamMemberInput,
  type ChangeTeamMemberRoleInput,
  type RemoveTeamMemberInput,
  type SearchAssignableUsersInput,
  type SearchAssignableUsersOutput,
  type UpdateMemberJobTitleInput,
  type WorkspaceActionOutput,
} from '../domain/teams';

const OK: WorkspaceActionOutput = { success: true };

/** 멤버 구성을 바꾸는 흐름은 전부 같은 팀 키로 직렬화한다 — 마지막 팀장 판정의 경합 차단. */
async function lockTeamMembers(tx: DbTransaction, teamId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('team-members-' || ${teamId}))`);
}

/** 해산되지 않은 팀인지 확인한다. 해산된 팀에는 아무도 넣지 않는다(ADR-0011). */
async function requireActiveTeam(tx: DbTransaction, teamId: string): Promise<void> {
  const team = await tx.query.teams.findFirst({
    where: and(eq(teams.id, teamId), eq(teams.status, 'active')),
    columns: { id: true },
  });
  if (!team) throw new TeamNotFoundError();
}

/** 이 사람이 지금 소속된 활성 팀 id 들. */
async function activeTeamIdsOf(tx: DbTransaction, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, userId), eq(teams.status, 'active')));
  return rows.map((row) => row.teamId);
}

/**
 * 팀원 추가 검색 (.pen FLOW 7-3) — **미배치 internal active 사용자만**.
 *
 * 타 팀 active 멤버는 잡히지 않는다("이동이 필요하면 슈퍼어드민에게 요청하세요"). 슈퍼어드민은
 * 팀 소속과 무관하고, guest·fieldwork 는 팀 멤버십 자체가 금지다(스펙 §1).
 *
 * teamId 는 결과를 좁히는 데 쓰이지 않는다 — 조건이 "어느 팀에도 없을 것" 이라 이미 이 팀
 * 멤버도 제외된다. 권한 판정(그 팀 관리자인가)에만 쓰인다.
 */
export async function searchAssignableUsers(
  input: SearchAssignableUsersInput,
): Promise<SearchAssignableUsersOutput> {
  const hasActiveMembership = db
    .select({ one: sql`1` })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, users.id), eq(teams.status, 'active')));

  const keyword = input.query;
  return db
    .select({ userId: users.id, name: users.name, email: users.email, jobTitle: users.jobTitle })
    .from(users)
    .where(
      and(
        eq(users.status, 'active'),
        eq(users.userType, 'internal'),
        eq(users.isSuperadmin, false),
        notExists(hasActiveMembership),
        keyword.length > 0
          ? or(ilike(users.name, `%${keyword}%`), ilike(users.email, `%${keyword}%`))
          : undefined,
      ),
    )
    .orderBy(asc(users.name))
    .limit(20);
}

/**
 * 팀원 추가 — pull 모델 (.pen FLOW 7-3).
 *
 * 잠금 키가 **사용자** 기준인 이유: 판정("이미 다른 팀에 있는가")이 사용자 축이라, 서로 다른
 * 두 팀에서 같은 사람을 동시에 당기면 팀 키로는 직렬화되지 않는다. 팀 구성 잠금도 함께
 * 잡아 마지막 팀장 판정과 순서를 맞춘다 — 두 키의 획득 순서는 이 함수 하나로 고정된다.
 */
export async function addMember(
  actor: { isSuperadmin: boolean },
  input: AddTeamMemberInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('team-member-user-' || ${input.userId}))`,
    );
    await lockTeamMembers(tx, input.teamId);
    await requireActiveTeam(tx, input.teamId);

    const target = await tx.query.users.findFirst({
      where: eq(users.id, input.userId),
      columns: { id: true, status: true, userType: true, isSuperadmin: true },
    });
    if (!target) throw new TargetUserNotFoundError();

    assertMemberAssignable({
      actor,
      target,
      teamId: input.teamId,
      activeTeamIds: await activeTeamIdsOf(tx, input.userId),
    });

    try {
      await tx
        .insert(teamMembers)
        .values({ teamId: input.teamId, userId: input.userId, role: input.role });
    } catch (err) {
      // 잠금 밖에서 만들어진 행(다른 경로·수동 삽입)과 부딪히면 같은 결론이다.
      if (isUniqueViolation(err)) throw new AlreadyTeamMemberError();
      throw err;
    }
    return OK;
  });
}

/** 역할 변경 — 마지막 팀장 강등 금지. */
export async function changeMemberRole(
  input: ChangeTeamMemberRoleInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    await lockTeamMembers(tx, input.teamId);

    const member = await tx.query.teamMembers.findFirst({
      where: and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId)),
      columns: { id: true, role: true },
    });
    if (!member) throw new TeamMemberNotFoundError();

    if (member.role === 'leader' && input.role === 'member') {
      assertLastLeaderKept({
        currentRole: member.role,
        leaderCount: await countLeaders(tx, input.teamId),
      });
    }

    await tx.update(teamMembers).set({ role: input.role }).where(eq(teamMembers.id, member.id));
    return OK;
  });
}

/**
 * 팀원 제외 — 마지막 팀장은 제외할 수 없다.
 *
 * 제외된 사람은 미배치가 된다(다른 팀 겸직이 있으면 그 팀에는 남는다). 소유 설문 승계
 * 확인은 여기 없다 — 설문 소유자 개념이 티켓 07 에서 생기고, 승계 제안은 티켓 19 가 붙인다.
 */
export async function removeMember(input: RemoveTeamMemberInput): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    await lockTeamMembers(tx, input.teamId);

    const member = await tx.query.teamMembers.findFirst({
      where: and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId)),
      columns: { id: true, role: true },
    });
    if (!member) throw new TeamMemberNotFoundError();

    assertLastLeaderKept({
      currentRole: member.role,
      leaderCount: await countLeaders(tx, input.teamId),
    });

    await tx.delete(teamMembers).where(eq(teamMembers.id, member.id));
    return OK;
  });
}

/**
 * 직책 수정 — users 전역 속성이지만 팀 상세에서만 고친다 (.pen FLOW 7-2).
 *
 * **대상이 그 팀 소속인지 먼저 확인한다.** 호출자 권한 검사(procedure 의 팀 관리자 판정)는
 * "요청자가 어느 팀의 관리자인가" 만 말해줄 뿐 "대상이 그 팀 사람인가" 는 말해주지 않는다.
 * 이 확인이 빠지면 팀 A 팀장이 userId 만 갈아끼워 타 팀·미배치·슈퍼어드민의 직책을 바꾼다
 * (워크트리 Task 4 의 IDOR — 재발 금지 항목).
 */
export async function updateMemberJobTitle(
  input: UpdateMemberJobTitleInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    const member = await tx.query.teamMembers.findFirst({
      where: and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId)),
      columns: { id: true },
    });
    if (!member) throw new TeamMemberNotFoundError();

    const [row] = await tx
      .update(users)
      .set({ jobTitle: input.jobTitle, updatedAt: new Date() })
      .where(eq(users.id, input.userId))
      .returning({ id: users.id });
    if (!row) throw new TargetUserNotFoundError();

    return OK;
  });
}

/** 이 팀의 현재 팀장 수 (대상 포함). */
async function countLeaders(tx: DbTransaction, teamId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'leader')));
  return row?.value ?? 0;
}
