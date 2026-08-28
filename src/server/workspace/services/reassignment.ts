import type { SQL } from 'drizzle-orm';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import { surveyOwnershipEvents, surveys, teamMembers, teams, users } from '@/db/schema';
import { isUniqueViolation } from '@/lib/pg-error';

import {
  type AssignSurveysInput,
  type AssignSurveysOutput,
  type AssignUserToTeamInput,
  type ListOwnerCandidatesOutput,
  OwnerNotInTeamError,
  type PendingSurveyDetailOutput,
  type PendingSurveyItem,
  type ReassignmentInboxOutput,
  SurveyNotPendingError,
  type UnassignedUserItem,
  UserAlreadyAssignedError,
} from '../domain/reassignment';
import {
  AlreadyTeamMemberError,
  TargetUserNotFoundError,
  TeamNotFoundError,
  type WorkspaceActionOutput,
  assertMemberAssignable,
} from '../domain/teams';
import { activeTeamIdsOf, lockTeamMembers, recordMemberEvent, requireActiveTeam } from './members';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 인박스 목록의 상한.
 *
 * 0089 백필이 **팀 도입 이전 설문 전부**를 `assignment_pending` 으로 세웠으므로 배치 대기
 * 목록은 초기 운영에서 수천 건일 수 있다(.pen 목업의 50 은 예시다). 전량을 내려보내면 첫
 * 진입이 그대로 멈추므로 목록만 자르고 **지표는 전체 수를 센다** — 화면이 「상위 N건」임을
 * 말하는 근거가 그 차이다. 일괄 배치 상한(200)과 같은 수라 한 화면을 통째로 처리할 수 있다.
 */
const INBOX_PAGE_SIZE = 200;

/**
 * 이 사람의 **유효 소속** 서브쿼리 — archived 팀은 소속이 아니다(ADR-0011).
 *
 * 판정 자체는 read-model 의 getActiveTeamMemberships 가 정본이지만 그건 사용자 한 명을
 * 왕복으로 읽는다. 인박스는 「소속이 하나도 없는 사람」을 목록에서 걸러야 해서 같은 규칙을
 * SQL 로 세운다 — 조건(active 팀만 조인)이 정확히 같은 것이 그 정본과의 계약이다.
 */
function activeMembershipOf(userIdColumn: typeof users.id) {
  return db
    .select({ one: sql`1` })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, userIdColumn), eq(teams.status, 'active')));
}

/** 미배치 사용자를 고르는 조건 — 목록과 지표가 **같은 술어**를 봐야 수가 어긋나지 않는다. */
const UNASSIGNED_USER_WHERE = and(
  eq(users.status, 'active'),
  eq(users.userType, 'internal'),
  eq(users.isSuperadmin, false),
  notExists(activeMembershipOf(users.id)),
);

/** 배치 대기 설문을 고르는 조건 — 위와 같은 이유로 한 곳에 둔다. */
/**
 * 인박스가 받는 설문 = **배치 대기 또는 승계 대기** · 삭제되지 않음.
 *
 * 둘을 한 목록에 두는 이유는 처리자가 하는 일이 같기 때문이다 — 새 소유자를 정해 주는 것.
 * 다른 것은 원인뿐이다(팀 해산 vs 소유자 퇴사, 티켓 13·19). 탭을 나누면 「지금 손봐야 할
 * 설문」을 두 곳에서 세어야 한다.
 *
 * `assignment_pending` 에 `teamId IS NULL` 을 따로 묻지 않는 이유는 DB CHECK 가 둘을 한 몸으로
 * 강제해서다(surveys_assignment_check) — 두 조건을 다 쓰면 어느 쪽이 정본인지 흐려진다.
 * 승계 대기는 팀을 그대로 갖는다(소유자만 비었다).
 */
const PENDING_SURVEY_WHERE = and(
  or(
    eq(surveys.assignmentStatus, 'assignment_pending'),
    eq(surveys.ownershipStatus, 'succession_pending'),
  ),
  isNull(surveys.deletedAt),
);

/**
 * 미배치 사용자 = internal · active · 슈퍼어드민 아님 · **활성 팀 소속 0**.
 *
 * 슈퍼어드민을 빼는 이유는 팀 소속과 무관한 전역 관리자라서다(CONTEXT.md) — 인박스에 두면
 * 「처리 대기」가 영원히 줄지 않는다. guest·fieldwork 는 팀 멤버십 자체가 금지다(스펙 §1).
 */
async function loadUnassignedUsers(): Promise<UnassignedUserItem[]> {
  const rows = await db
    .select({ userId: users.id, name: users.name, email: users.email, jobTitle: users.jobTitle })
    .from(users)
    .where(UNASSIGNED_USER_WHERE)
    .orderBy(asc(users.name))
    .limit(INBOX_PAGE_SIZE);

  if (rows.length === 0) return [];

  // 「이전 소속」은 남아 있는 **archived 팀 멤버십 행**에서 읽는다. 해산이 행을 지우지 않는
  // 것이 이 열의 근거다(ADR-0011, 티켓 13) — 지웠다면 이 사람들이 어디서 왔는지 알 길이 없다.
  // 미배치인데 멤버십 행이 있다면 그 팀은 archived 일 수밖에 없으므로 상태를 다시 묻지 않는다.
  const memberships = await db
    .select({ userId: teamMembers.userId, teamName: teams.name, archivedAt: teams.archivedAt })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        inArray(
          teamMembers.userId,
          rows.map((r) => r.userId),
        ),
        eq(teams.status, 'archived'),
      ),
    )
    .orderBy(desc(teams.archivedAt));

  // 겸직 상태로 여러 팀이 함께 해산됐을 수 있다 — 가장 최근에 해산된 팀을 직전 소속으로 본다.
  const previousTeamByUser = new Map<string, string>();
  for (const row of memberships) {
    if (!previousTeamByUser.has(row.userId)) previousTeamByUser.set(row.userId, row.teamName);
  }

  return rows.map((row) => ({
    ...row,
    previousTeamName: previousTeamByUser.get(row.userId) ?? null,
  }));
}

/** 인박스 목록 조회 — 조건은 PENDING_SURVEY_WHERE 가 정한다. */
async function loadPendingSurveys(where: SQL | undefined = PENDING_SURVEY_WHERE) {
  return db
    .select({
      surveyId: surveys.id,
      title: surveys.title,
      ownerUserId: surveys.ownerUserId,
      ownerName: users.name,
      ownerHasTeam: exists(activeMembershipOf(users.id)),
      updatedAt: surveys.updatedAt,
    })
    .from(surveys)
    .leftJoin(users, eq(users.id, surveys.ownerUserId))
    .where(where)
    .orderBy(desc(surveys.updatedAt))
    .limit(INBOX_PAGE_SIZE);
}

/** 감사에서 되짚은 출신 팀 — 설문 행에는 남지 않는다(해산이 team_id 를 NULL 로 내린다). */
async function loadPreviousTeamNames(surveyIds: string[]): Promise<Map<string, string>> {
  if (surveyIds.length === 0) return new Map();

  const rows = await db
    .select({
      surveyId: surveyOwnershipEvents.surveyId,
      teamName: teams.name,
      createdAt: surveyOwnershipEvents.createdAt,
    })
    .from(surveyOwnershipEvents)
    .innerJoin(teams, eq(teams.id, surveyOwnershipEvents.fromTeamId))
    .where(
      and(
        inArray(surveyOwnershipEvents.surveyId, surveyIds),
        eq(surveyOwnershipEvents.action, 'unassign'),
      ),
    )
    .orderBy(desc(surveyOwnershipEvents.createdAt));

  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.surveyId)) map.set(row.surveyId, row.teamName);
  }
  return map;
}

function toPendingSurveyItem(
  row: Awaited<ReturnType<typeof loadPendingSurveys>>[number],
  previousTeamName: string | null,
): PendingSurveyItem {
  return {
    surveyId: row.surveyId,
    title: row.title,
    ownerUserId: row.ownerUserId,
    ownerName: row.ownerName,
    // 소유자가 없는 설문(팀 도입 이전 백필분)은 「미배치」가 아니라 소유자 자체가 없는 것이다.
    ownerIsUnassigned: row.ownerUserId !== null && !row.ownerHasTeam,
    previousTeamName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 재배치 센터 인박스 (.pen FLOW 8-2) — 지표 + 두 탭의 목록을 한 번에 내려준다. */
export async function getReassignmentInbox(): Promise<ReassignmentInboxOutput> {
  const [unassignedUsers, surveyRows, archivedTeamRows, unassignedUserRows, pendingSurveyRows] =
    await Promise.all([
      loadUnassignedUsers(),
      loadPendingSurveys(),
      db.select({ value: count() }).from(teams).where(eq(teams.status, 'archived')),
      // 지표는 **목록 상한과 무관한 전체 수**다 — 화면이 「상위 N건」임을 아는 근거다.
      db.select({ value: count() }).from(users).where(UNASSIGNED_USER_WHERE),
      db.select({ value: count() }).from(surveys).where(PENDING_SURVEY_WHERE),
    ]);

  const previousTeams = await loadPreviousTeamNames(surveyRows.map((r) => r.surveyId));

  return {
    summary: {
      archivedTeamCount: archivedTeamRows[0]?.value ?? 0,
      unassignedUserCount: unassignedUserRows[0]?.value ?? 0,
      pendingSurveyCount: pendingSurveyRows[0]?.value ?? 0,
    },
    unassignedUsers,
    pendingSurveys: surveyRows.map((row) =>
      toPendingSurveyItem(row, previousTeams.get(row.surveyId) ?? null),
    ),
  };
}

/**
 * 단건 재배치 화면(.pen FLOW 8-4)이 여는 설문 하나.
 *
 * 배치 대기가 아닌 설문은 **없는 설문과 같이** null 이다 — 이미 배치된 설문의 존재를
 * 재배치 주소로 확인할 수 있게 두면 인박스 밖 설문의 id 스캔이 된다.
 */
export async function getPendingSurvey(
  surveyId: string,
): Promise<PendingSurveyDetailOutput | null> {
  const rows = await loadPendingSurveys(and(PENDING_SURVEY_WHERE, eq(surveys.id, surveyId)));
  const row = rows[0];
  if (!row) return null;

  const previousTeams = await loadPreviousTeamNames([row.surveyId]);
  return toPendingSurveyItem(row, previousTeams.get(row.surveyId) ?? null);
}

/**
 * 새 소유자 후보 = 목적지 팀의 **active internal 멤버**.
 *
 * 팀 밖 사람을 후보로 두지 않는 이유는 화면 편의가 아니라 판정 코어와의 정합이다 —
 * `resolveSurveyCapabilities` 의 소유자 분기는 소유 팀 소속일 때만 전권을 준다(티켓 13).
 * 목록과 서버 검증(OwnerNotInTeamError)이 같은 모집단을 봐야 화면이 고를 수 있는 값이
 * 전부 통과한다.
 */
export async function listOwnerCandidates(teamId: string): Promise<ListOwnerCandidatesOutput> {
  return db
    .select({
      userId: users.id,
      name: users.name,
      jobTitle: users.jobTitle,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teams.status, 'active'),
        eq(users.status, 'active'),
        eq(users.userType, 'internal'),
      ),
    )
    .orderBy(desc(teamMembers.role), asc(users.name));
}

/**
 * 미배치 사용자 팀 배정 (.pen FLOW 8-3).
 *
 * 팀 상세의 「팀원 추가」와 **같은 잠금·같은 감사**를 쓴다. 잠금 키가 사용자와 팀 둘인 것도,
 * 획득 순서가 사용자 → 팀인 것도 addMember 와 맞춘 것이다 — 두 입구가 순서를 달리하면
 * 같은 사람을 두 곳에서 동시에 배정할 때 데드락이 된다.
 *
 * 직책을 같은 트랜잭션에서 쓰는 것이 이 입구만의 차이다. 화면이 목적지·역할·직책을 한 번에
 * 받으므로 나눠 쓰면 「팀은 들어갔는데 직책은 안 바뀐」 절반 상태가 남는다.
 */
export async function assignUserToTeam(
  actor: { id: string; isSuperadmin: boolean },
  input: AssignUserToTeamInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction((tx) => assignUserToTeamInTx(tx, actor, input));
}

/**
 * 배정의 트랜잭션 본문 — 호출측이 트랜잭션을 소유한다.
 *
 * 재입사(server/workflows/user-rehire)가 상태 전이와 **한 트랜잭션**으로 묶기 위해 이 모양이
 * 필요하다. 그 흐름에서는 상태 전이가 먼저 커밋되지 않은 채 여기 들어오므로, 아래 대상 조회가
 * 같은 트랜잭션 안에서 이미 `active` 가 된 행을 본다 — assertMemberAssignable 의 재직 검사가
 * 통과하는 것이 그 순서 덕분이다. 순서를 뒤집으면 재입사가 자기 자신의 상태 검사에 걸린다.
 *
 * `jobTitle` 이 undefined 면 직책을 건드리지 않는다. 재입사는 상태 전이 쪽이 이미 썼기 때문에
 * 여기서 또 쓰면 같은 트랜잭션에서 같은 열을 두 번 갱신하게 된다.
 */
export async function assignUserToTeamInTx(
  tx: DbTransaction,
  actor: { id: string; isSuperadmin: boolean },
  input: Omit<AssignUserToTeamInput, 'jobTitle'> & { jobTitle?: string | null },
): Promise<WorkspaceActionOutput> {
  {
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

    const activeTeamIds = await activeTeamIdsOf(tx, input.userId);
    // 인박스는 미배치 목록이다 — 그 사이 어딘가에 배정됐다면 조용히 겸직을 만들지 않고 멈춘다.
    if (activeTeamIds.length > 0) throw new UserAlreadyAssignedError();

    assertMemberAssignable({ actor, target, teamId: input.teamId, activeTeamIds });

    try {
      await tx
        .insert(teamMembers)
        .values({ teamId: input.teamId, userId: input.userId, role: input.role });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AlreadyTeamMemberError();
      throw err;
    }

    // 빈 문자열은 「직책 없음」으로 접는다 — 선택 입력이라 미입력과 지우기를 가르지 않는다.
    // undefined 는 「건드리지 말라」는 뜻이라 갈라 본다(재입사 경로).
    if (input.jobTitle !== undefined) {
      const jobTitle = input.jobTitle !== null && input.jobTitle.length > 0 ? input.jobTitle : null;
      await tx
        .update(users)
        .set({ jobTitle, updatedAt: new Date() })
        .where(eq(users.id, input.userId));
    }

    await recordMemberEvent(tx, {
      teamId: input.teamId,
      targetUserId: input.userId,
      actorUserId: actor.id,
      action: 'member_add',
      metadata: { toRole: input.role },
    });
    return OK;
  }
}

/**
 * 배치 대기 설문을 팀에 배치한다 (.pen FLOW 8-4 단건 · 9-2 일괄).
 *
 * **한 건이라도 실패하면 전체 취소다.** 부분 성공을 허용하면 화면이 어떤 것이 넘어갔는지
 * 말할 수 없고, 다시 누르면 이미 넘어간 것들이 「배치 대기가 아님」으로 또 막힌다.
 *
 * 잠금 순서는 팀 멤버 → 팀 행 → 설문(id 오름차순)이며 해산(dissolveTeam)과 같다. 순서를
 * 맞추는 것이 목적이 아니라, 해산과 배치가 **정확히 반대 방향의 같은 이동**이라 서로를
 * 기다려야 하기 때문이다.
 *
 * `updatedAt` 을 갱신한다. 그룹 이동(티켓 12)이 갱신하지 않는 것과 갈리는데, 그쪽은 폴더에
 * 넣는 일이고 이쪽은 소유 팀·소유자·공개 범위가 바뀌는 일이다. 해산도 같은 이유로 갱신한다.
 */
export async function assignSurveys(
  actorUserId: string,
  input: AssignSurveysInput,
): Promise<AssignSurveysOutput> {
  return db.transaction(async (tx) => {
    // 멤버 구성을 잠근다 — 새 소유자가 그 팀 멤버라는 확인이 UPDATE 까지 유지돼야 한다.
    // 잠그지 않으면 확인과 쓰기 사이에 제외가 커밋되어, 자기 설문을 못 여는 소유자가 생긴다.
    await lockTeamMembers(tx, input.teamId);

    // 팀 행은 FOR SHARE — 해산의 FOR NO KEY UPDATE 와 충돌하므로 해산이 진행 중이면 여기서
    // 대기하다 archived 를 보고 거부된다(설문 생성 경로 resolveNewSurveyOwnership 과 같다).
    const [team] = await tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.id, input.teamId), eq(teams.status, 'active')))
      .for('share');
    if (!team) throw new TeamNotFoundError();

    await assertOwnerInTeam(tx, input.teamId, input.ownerUserId);

    // id 오름차순으로 잠근다 — 담기(collectSurveysIntoGroup)·해산과 같은 순서라 사이클이 없다.
    const rows = await tx
      .select({
        id: surveys.id,
        title: surveys.title,
        teamId: surveys.teamId,
        ownerUserId: surveys.ownerUserId,
        visibility: surveys.visibility,
        assignmentStatus: surveys.assignmentStatus,
        ownershipStatus: surveys.ownershipStatus,
        deletedAt: surveys.deletedAt,
      })
      .from(surveys)
      .where(inArray(surveys.id, input.surveyIds))
      .orderBy(asc(surveys.id))
      .for('update');

    // 없는 id 와 「배치 대기가 아닌」 id 를 **같은 사유로** 접는다. 갈라 말하면 재배치
    // 주소가 전체 설문의 존재 확인 창구가 된다.
    const found = new Set(rows.map((r) => r.id));
    const missing = input.surveyIds.find((id) => !found.has(id));
    if (missing) throw new SurveyNotPendingError(missing);

    for (const row of rows) {
      // 인박스에 서는 두 상태를 모두 받는다 — 배치 대기(해산)와 승계 대기(퇴사, 티켓 19).
      // 처리자가 하는 일이 같으므로(새 소유자 지정) 표면도 하나다.
      const isPending =
        row.assignmentStatus === 'assignment_pending' ||
        row.ownershipStatus === 'succession_pending';
      if (!isPending || row.deletedAt !== null) {
        throw new SurveyNotPendingError(row.id);
      }
    }

    // 그룹은 **팀이 실제로 바뀐 설문만** 미분류로 내린다(티켓 12 인계). 배치 대기 설문은
    // 팀이 없었으므로 언제나 여기 들어오고, 승계 대기 설문은 같은 팀으로 해소하면 폴더 정리를
    // 잃지 않는다 — 무조건 NULL 로 두면 소유자만 바꾸는 해소가 폴더까지 지운다.
    const movedTeamIds = rows.filter((row) => row.teamId !== input.teamId).map((row) => row.id);

    await tx
      .update(surveys)
      .set({
        teamId: input.teamId,
        ownerUserId: input.ownerUserId,
        visibility: input.visibility,
        assignmentStatus: 'assigned',
        // 승계 대기도 여기서 해소된다 — 새 소유자가 정해졌다는 것이 그 상태의 종료 조건이다.
        ownershipStatus: 'normal',
        updatedAt: new Date(),
      })
      .where(inArray(surveys.id, input.surveyIds));

    if (movedTeamIds.length > 0) {
      await tx
        .update(surveys)
        .set({ surveyGroupId: null })
        .where(inArray(surveys.id, movedTeamIds));
    }

    await tx.insert(surveyOwnershipEvents).values(
      rows.map((row) => ({
        surveyId: row.id,
        action: 'assign' as const,
        fromOwnerId: row.ownerUserId,
        toOwnerId: input.ownerUserId,
        toTeamId: team.id,
        changedBy: actorUserId,
        metadata: {
          surveyTitle: row.title,
          toTeamName: team.name,
          fromVisibility: row.visibility,
          toVisibility: input.visibility,
        },
      })),
    );

    return { assignedCount: rows.length };
  });
}

/** 새 소유자가 목적지 팀의 활성 멤버인가 — 잠긴 멤버 구성 위에서 본다. */
async function assertOwnerInTeam(
  tx: DbTransaction,
  teamId: string,
  ownerUserId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, ownerUserId),
        eq(users.status, 'active'),
        eq(users.userType, 'internal'),
      ),
    );
  if (!row) throw new OwnerNotInTeamError();
}
