import { and, asc, count, eq, ilike, notExists, or, sql } from 'drizzle-orm';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import { teamLifecycleEvents, teamMembers, teams, users } from '@/db/schema';
import { isUniqueViolation } from '@/lib/pg-error';
import type { TeamLifecycleAction, TeamLifecycleMetadata } from '@/shared/contracts/workspace';

import {
  type AddTeamMemberInput,
  AlreadyTeamMemberError,
  type ChangeTeamMemberRoleInput,
  type RemoveTeamMemberInput,
  type SearchAssignableUsersInput,
  type SearchAssignableUsersOutput,
  TargetUserNotFoundError,
  TeamMemberNotFoundError,
  TeamNotFoundError,
  type UpdateMemberJobTitleInput,
  type WorkspaceActionOutput,
  assertLastLeaderKept,
  assertMemberAssignable,
} from '../domain/teams';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 멤버 구성 변화를 감사에 남긴다.
 *
 * 재배치 센터의 팀 배정(services/reassignment)도 이 함수를 부른다 — 입구가 달라도 남는
 * 사건은 같은 `member_add` 여야 한다. 감사 모양이 두 벌이 되면 팀 상세의 이력이 갈린다.
 *
 * 제외는 team_members 행을 지우므로 이 행이 없으면 "누가 언제 누구를 뺐는가" 가 어디에도
 * 남지 않는다. 역할은 사건 시점 값을 함께 적는다 — 나중에 조인하면 지금 역할만 보인다.
 */
export async function recordMemberEvent(
  tx: DbTransaction,
  input: {
    teamId: string;
    targetUserId: string;
    actorUserId: string;
    action: Extract<TeamLifecycleAction, 'member_add' | 'member_role' | 'member_remove'>;
    metadata?: TeamLifecycleMetadata;
  },
): Promise<void> {
  await tx.insert(teamLifecycleEvents).values({
    teamId: input.teamId,
    action: input.action,
    targetUserId: input.targetUserId,
    changedBy: input.actorUserId,
    metadata: input.metadata ?? null,
  });
}

/**
 * 멤버 구성을 바꾸는 흐름은 전부 같은 팀 키로 직렬화한다 — 마지막 팀장 판정의 경합 차단.
 *
 * 해산(teams 의 dissolveTeam)도 이 키를 잡는다. 해산은 멤버십의 **유효성**을 통째로 끊는
 * 일이라 멤버 추가와 같은 축의 경합이다 — 키가 갈리면 해산 직전에 들어온 멤버가 archived
 * 팀의 유령 행으로 남는다. 키 문자열이 두 벌이 되지 않게 정의는 여기 하나다.
 */
export async function lockTeamMembers(tx: DbTransaction, teamId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('team-members-' || ${teamId}))`);
}

/** 해산되지 않은 팀인지 확인한다. 해산된 팀에는 아무도 넣지 않는다(ADR-0011). */
export async function requireActiveTeam(tx: DbTransaction, teamId: string): Promise<void> {
  const team = await tx.query.teams.findFirst({
    where: and(eq(teams.id, teamId), eq(teams.status, 'active')),
    columns: { id: true },
  });
  if (!team) throw new TeamNotFoundError();
}

/** 이 사람이 지금 소속된 활성 팀 id 들. */
export async function activeTeamIdsOf(tx: DbTransaction, userId: string): Promise<string[]> {
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
  actor: { id: string; isSuperadmin: boolean },
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
    await recordMemberEvent(tx, {
      teamId: input.teamId,
      targetUserId: input.userId,
      actorUserId: actor.id,
      action: 'member_add',
      metadata: { toRole: input.role },
    });
    return OK;
  });
}

/**
 * 이 사람의 **활성 팀 소속을 전부 끊는다** — 재입사가 새 소속을 앉히기 전의 정리 (티켓 14).
 *
 * 퇴사는 멤버십 행을 지우지 않는다. 팀 상세가 비활성 멤버를 표식과 함께 계속 보여주기
 * 위해서다(안 보이면 퇴사한 사람이 팀장 자리를 차지한 채 남아 있는 것을 아무도 눈치채지
 * 못한다). 그래서 재입사 시점에는 옛 소속이 그대로 남아 있고, 정리하지 않으면 새 소속
 * 배정이 「이미 다른 팀에 소속됨」으로 막힌다 — .pen FLOW 9-4 의 「이전 팀 멤버십은 자동
 * 복구하지 않습니다」가 지켜지지 않는 것이기도 하다.
 *
 * **마지막 팀장 가드를 부르지 않는다.** 그 가드가 세는 것은 활성 팀장이고 이 시점의 대상은
 * 이미 비활성(퇴사)이라 애초에 세어지지 않는다 — 부르면 "유일한 팀장이 퇴사해 활성 팀장이
 * 0명" 인 팀에서 재입사가 영구히 막힌다(AGENTS.md 「마지막 팀장 가드가 지키는 것」).
 *
 * 팀 키를 **id 오름차순으로** 잡는다. 겸직이면 여러 팀을 한 트랜잭션에서 만지는 유일한
 * 흐름이라, 순서를 고정하지 않으면 서로 다른 재입사 둘이 사이클을 만든다.
 */
export async function clearActiveMembershipsInTx(
  tx: DbTransaction,
  actorUserId: string,
  userId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: teamMembers.id, teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, userId), eq(teams.status, 'active')))
    .orderBy(asc(teamMembers.teamId));

  for (const row of rows) {
    await lockTeamMembers(tx, row.teamId);
    await tx.delete(teamMembers).where(eq(teamMembers.id, row.id));
    await recordMemberEvent(tx, {
      teamId: row.teamId,
      targetUserId: userId,
      actorUserId,
      action: 'member_remove',
      metadata: { fromRole: row.role },
    });
  }
}

/** 역할 변경 — 마지막 팀장 강등 금지. */
export async function changeMemberRole(
  actorUserId: string,
  input: ChangeTeamMemberRoleInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    await lockTeamMembers(tx, input.teamId);
    // 해산된 팀의 명부는 감사 기록이다 — 사후 변조를 막는다(티켓 13). 일반 사용자는
    // assertTeamManager 가 archived 팀 역할을 null 로 만들어 이미 막히지만, 슈퍼어드민은
    // 그 관문을 소속 조회 없이 통과한다.
    await requireActiveTeam(tx, input.teamId);

    const member = await findMemberWithStatus(tx, input.teamId, input.userId);
    if (!member) throw new TeamMemberNotFoundError();

    // 팀장을 남기는 규칙은 도메인 한 곳에만 둔다 — 여기서 "leader → member 일 때만" 을
    // 다시 쓰면 같은 판정이 두 벌이 된다. 승격(→leader)은 팀장을 줄이지 않으므로 묻지 않는다.
    if (input.role === 'member') {
      assertLastLeaderKept({
        currentRole: member.role,
        targetIsActive: member.status === 'active',
        activeLeaderCount: await countActiveLeaders(tx, input.teamId),
      });
    }

    if (member.role === input.role) return OK;

    await tx.update(teamMembers).set({ role: input.role }).where(eq(teamMembers.id, member.id));
    await recordMemberEvent(tx, {
      teamId: input.teamId,
      targetUserId: input.userId,
      actorUserId,
      action: 'member_role',
      metadata: { fromRole: member.role, toRole: input.role },
    });
    return OK;
  });
}

/**
 * 팀원 제외 — 마지막 팀장은 제외할 수 없다.
 *
 * 제외된 사람은 미배치가 된다(다른 팀 겸직이 있으면 그 팀에는 남는다). 소유 설문 승계
 * 확인은 여기 없다 — 설문 소유자 개념이 티켓 07 에서 생기고, 승계 제안은 티켓 19 가 붙인다.
 */
export async function removeMember(
  actorUserId: string,
  input: RemoveTeamMemberInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    await lockTeamMembers(tx, input.teamId);
    // 해산된 팀의 명부는 감사 기록이다 — 사후 변조를 막는다(티켓 13). 일반 사용자는
    // assertTeamManager 가 archived 팀 역할을 null 로 만들어 이미 막히지만, 슈퍼어드민은
    // 그 관문을 소속 조회 없이 통과한다.
    await requireActiveTeam(tx, input.teamId);

    const member = await findMemberWithStatus(tx, input.teamId, input.userId);
    if (!member) throw new TeamMemberNotFoundError();

    assertLastLeaderKept({
      currentRole: member.role,
      targetIsActive: member.status === 'active',
      activeLeaderCount: await countActiveLeaders(tx, input.teamId),
    });

    await tx.delete(teamMembers).where(eq(teamMembers.id, member.id));
    await recordMemberEvent(tx, {
      teamId: input.teamId,
      targetUserId: input.userId,
      actorUserId,
      action: 'member_remove',
      metadata: { fromRole: member.role },
    });
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
    // 형제 둘과 같은 순서로 잠근다 — 잠금 없이 확인만 하면 검사와 UPDATE 사이에 해산이
    // 커밋되어 그 검사가 아무것도 막지 못한다.
    await lockTeamMembers(tx, input.teamId);

    // 해산된 팀의 명부는 감사 기록이다 — 사후 변조를 막는다(티켓 13). 일반 사용자는
    // assertTeamManager 가 archived 팀 역할을 null 로 만들어 이미 막히지만, 슈퍼어드민은
    // 그 관문을 소속 조회 없이 통과한다.
    await requireActiveTeam(tx, input.teamId);

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

/**
 * 이 팀의 **활성** 팀장 수 (대상 포함).
 *
 * 정지·퇴사한 팀장은 로그인도 못 하므로 팀을 지키는 사람으로 세지 않는다 — 세면
 * "관리자가 있다" 는 판정이 거짓이 된다.
 */
async function countActiveLeaders(tx: DbTransaction, teamId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.role, 'leader'),
        eq(users.status, 'active'),
      ),
    );
  return row?.value ?? 0;
}

/** 멤버 행 + 그 사람의 계정 상태 — 마지막 팀장 판정이 둘을 함께 봐야 한다. */
async function findMemberWithStatus(tx: DbTransaction, teamId: string, userId: string) {
  const [row] = await tx
    .select({ id: teamMembers.id, role: teamMembers.role, status: users.status })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  return row;
}
