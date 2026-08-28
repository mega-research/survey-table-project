import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import {
  surveyOwnershipEvents,
  surveyParticipants,
  surveys,
  teamMembers,
  teams,
  users,
} from '@/db/schema';
import type {
  ListTransferCandidatesOutput,
  SuccessionAssignment,
  SuccessionPlanItem,
  TransferCandidateItem,
  TransferSurveyOwnershipInput,
  WorkspaceActionOutput,
} from '@/shared/contracts/workspace-io';

import {
  AmbiguousOwnerTeamError,
  NotATransferCandidateError,
  OwnershipSurveyNotFoundError,
  SelfTransferError,
  type SuccessionCandidate,
  proposeSuccessor,
} from '../domain/succession';

const OK: WorkspaceActionOutput = { success: true };

// ─────────────────────────────────────────────────────────────────────────────
// 후보 조회
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이전 후보 = **같은 팀 active 멤버 + 이 설문 참여자** (스펙 §4, .pen 4-4).
 *
 * 두 모집단을 UNION 하는 이유는 둘 다 「이 설문을 이어받을 수 있는 사람」이기 때문이다 —
 * 팀 사람은 소유 팀의 맥락을, 참여자는 그 설문의 맥락을 갖는다. 지금 소유자는 빠진다
 * (자기에게 넘기는 요청은 아무 일도 하지 않는다).
 *
 * 비활성·비내부 계정은 양쪽 모두에서 빠진다 — 넘겨받아도 로그인조차 못 한다.
 */
export async function listTransferCandidates(
  surveyId: string,
): Promise<ListTransferCandidatesOutput> {
  // FROM 은 users 이고 설문은 **한 행짜리 조인**이다. 반대로 두면 users 와의 조인 조건이
  // 없어 전 사용자 카테시안이 만들어진 뒤 WHERE 로 걸러진다.
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      teamName: teams.name,
    })
    .from(users)
    .innerJoin(surveys, and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)))
    .leftJoin(
      surveyParticipants,
      and(
        eq(surveyParticipants.surveyId, surveys.id),
        eq(surveyParticipants.userId, users.id),
        eq(surveyParticipants.kind, 'member'),
      ),
    )
    .leftJoin(
      teamMembers,
      and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, surveys.teamId)),
    )
    .leftJoin(teams, and(eq(teams.id, teamMembers.teamId), eq(teams.status, 'active')))
    .where(
      and(
        eq(users.status, 'active'),
        eq(users.userType, 'internal'),
        // 소유자는 후보가 아니다 — 자기에게 넘기는 요청은 아무 일도 하지 않는다.
        sql`${users.id} is distinct from ${surveys.ownerUserId}`,
        // 둘 중 하나여야 한다 — 소유 팀의 활성 멤버이거나, 이 설문 참여자이거나.
        sql`(${teams.id} is not null or ${surveyParticipants.id} is not null)`,
      ),
    )
    .orderBy(asc(users.name));

  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    // 조인이 **소유 팀** 기준이라 값이 차 있으면 그 팀 사람이라는 뜻이다. 타 팀 참여자는
    // null 이고 화면이 「참여자」로 적는다(.pen 4-4 의 두 가지 표기).
    teamName: row.teamName,
    source: row.teamName ? ('team_member' as const) : ('participant' as const),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 이전 실행 — 수동 이전과 승계가 함께 쓰는 한 자리
// ─────────────────────────────────────────────────────────────────────────────

interface OwnershipTargetRow {
  id: string;
  title: string;
  teamId: string | null;
  ownerUserId: string | null;
  visibility: 'team' | 'invite_only';
}

/**
 * 새 소유자가 설 팀을 정한다 — **소유자는 소유 팀 사람이어야 한다**.
 *
 * `resolveSurveyCapabilities` 의 소유자 분기가 소유 팀 소속을 함께 묻기 때문이다(티켓 13
 * revocation 계약). 팀 밖 사람에게 그냥 넘기면 배치는 성공하는데 그 소유자가 자기 설문을
 * 못 여는 설문이 만들어진다 — 재배치 센터가 `OwnerNotInTeamError` 로 막는 것과 같은 사고다.
 *
 * 그래서 셋 중 하나다.
 *  ① 새 소유자가 이미 소유 팀 사람 → 팀은 그대로.
 *  ② 타 팀 참여자이고 활성 팀이 **하나** → 설문이 그 팀으로 따라간다(+ 그룹 미분류).
 *  ③ 활성 팀이 0개이거나 둘 이상 → 거부. 시스템이 고르면 설문이 엉뚱한 팀 목록에 나타난다.
 */
async function resolveOwningTeam(
  tx: DbTransaction,
  survey: OwnershipTargetRow,
  newOwnerUserId: string,
): Promise<{ teamId: string; movedTeam: boolean }> {
  const memberships = await tx
    .select({ teamId: teamMembers.teamId, teamName: teams.name })
    .from(teamMembers)
    .innerJoin(teams, and(eq(teams.id, teamMembers.teamId), eq(teams.status, 'active')))
    .where(eq(teamMembers.userId, newOwnerUserId));

  if (survey.teamId && memberships.some((m) => m.teamId === survey.teamId)) {
    return { teamId: survey.teamId, movedTeam: false };
  }
  if (memberships.length === 0) {
    throw new AmbiguousOwnerTeamError(
      '새 소유자가 활성 팀에 속해 있지 않습니다. 팀에 배정한 뒤 다시 시도하세요.',
    );
  }
  if (memberships.length > 1) {
    throw new AmbiguousOwnerTeamError(
      '새 소유자가 여러 팀에 속해 있어 설문이 갈 팀을 정할 수 없습니다. 같은 팀 멤버에게 이전하세요.',
    );
  }
  return { teamId: memberships[0]!.teamId, movedTeam: true };
}

/**
 * 소유권 이전의 트랜잭션 본문 — 수동 이전(공유 모달)과 승계(퇴사 처리)가 **같은 자리**를 쓴다.
 *
 * 나누지 않는 이유는 불변식이 하나이기 때문이다: 소유자는 소유 팀 사람이어야 하고, 팀이
 * 움직이면 그룹은 미분류로 내려가야 한다(티켓 12 인계). 두 벌이면 한쪽만 조여진다.
 *
 * 설문 행을 `FOR UPDATE` 로 잠그고 **잠긴 값으로** 다시 판정한다 — 동시 이전 둘 중 하나만
 * 성공해야 한다(티켓 체크박스). 잠그지 않으면 둘 다 자기 기준으로 옳은 UPDATE 를 쓴다.
 */
export async function transferOwnershipInTx(
  tx: DbTransaction,
  actorUserId: string,
  surveyId: string,
  newOwnerUserId: string,
  options: { requireCandidate?: boolean } = {},
): Promise<void> {
  const [survey] = await tx
    .select({
      id: surveys.id,
      title: surveys.title,
      teamId: surveys.teamId,
      ownerUserId: surveys.ownerUserId,
      visibility: surveys.visibility,
    })
    .from(surveys)
    .where(and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)))
    .for('update');
  if (!survey) throw new OwnershipSurveyNotFoundError();
  if (survey.ownerUserId === newOwnerUserId) throw new SelfTransferError();

  const [target] = await tx
    .select({ status: users.status, userType: users.userType })
    .from(users)
    .where(eq(users.id, newOwnerUserId));
  if (!target || target.status !== 'active' || target.userType !== 'internal') {
    throw new NotATransferCandidateError();
  }

  // 수동 이전만 후보 자격을 요구한다. 승계는 처리자가 목록에서 고른 사람이고, 그 목록을
  // 만든 것이 같은 후보 규칙이라 여기서 다시 물으면 왕복만 는다.
  if (options.requireCandidate) {
    const candidates = await listTransferCandidates(surveyId);
    if (!candidates.some((c) => c.userId === newOwnerUserId)) {
      throw new NotATransferCandidateError();
    }
  }

  const { teamId, movedTeam } = await resolveOwningTeam(tx, survey, newOwnerUserId);

  await tx
    .update(surveys)
    .set({
      ownerUserId: newOwnerUserId,
      teamId,
      // 팀이 움직이면 그룹은 미분류로 내려간다 — 그룹은 팀 소유물이다(0090 헤더의 계약).
      ...(movedTeam ? { surveyGroupId: null } : {}),
      // 이전이 끝나면 승계 대기 상태는 해소된다.
      ownershipStatus: 'normal' as const,
      assignmentStatus: 'assigned' as const,
      updatedAt: new Date(),
    })
    .where(eq(surveys.id, surveyId));

  await tx.insert(surveyOwnershipEvents).values({
    surveyId,
    action: 'transfer',
    fromOwnerId: survey.ownerUserId,
    toOwnerId: newOwnerUserId,
    fromTeamId: survey.teamId,
    toTeamId: teamId,
    changedBy: actorUserId,
    metadata: { surveyTitle: survey.title, toVisibility: survey.visibility },
  });
}

/** 수동 이전 (.pen 4-4) — 공유 모달의 「소유권 이전」. */
export async function transferSurveyOwnership(
  actorUserId: string,
  input: TransferSurveyOwnershipInput,
): Promise<WorkspaceActionOutput> {
  await db.transaction((tx) =>
    transferOwnershipInTx(tx, actorUserId, input.surveyId, input.newOwnerUserId, {
      requireCandidate: true,
    }),
  );
  return OK;
}

// ─────────────────────────────────────────────────────────────────────────────
// 승계 — 퇴사 처리가 쓰는 미리보기와 적용
// ─────────────────────────────────────────────────────────────────────────────

/** 이 사람이 소유한 살아 있는 설문 — 퇴사 처리가 정리해야 할 목록. */
async function loadOwnedSurveys(dbc: DbTransaction | typeof db, userId: string) {
  return dbc
    .select({
      id: surveys.id,
      title: surveys.title,
      teamId: surveys.teamId,
      teamName: teams.name,
    })
    .from(surveys)
    .leftJoin(teams, eq(teams.id, surveys.teamId))
    .where(and(eq(surveys.ownerUserId, userId), isNull(surveys.deletedAt)))
    .orderBy(asc(surveys.id));
}

/**
 * 한 설문의 승계 후보를 제안 규칙이 읽는 모양으로 만든다.
 *
 * 후보 목록(listTransferCandidates)과 **같은 모집단**을 봐야 한다 — 제안된 사람이 드롭다운에
 * 없으면 처리자는 화면이 고장 난 것으로 읽는다.
 */
async function loadSuccessionCandidates(
  surveyId: string,
  teamId: string | null,
): Promise<{ candidates: TransferCandidateItem[]; rule: SuccessionCandidate[] }> {
  const candidates = await listTransferCandidates(surveyId);

  const participantRows = await db
    .select({ userId: surveyParticipants.userId, invitedAt: surveyParticipants.createdAt })
    .from(surveyParticipants)
    .where(and(eq(surveyParticipants.surveyId, surveyId), eq(surveyParticipants.kind, 'member')));
  const invitedAtOf = new Map(participantRows.map((r) => [r.userId, r.invitedAt]));

  const leaderRows = teamId
    ? await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .innerJoin(teams, and(eq(teams.id, teamMembers.teamId), eq(teams.status, 'active')))
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'leader')))
    : [];
  const leaderIds = new Set(leaderRows.map((r) => r.userId));

  return {
    candidates,
    rule: candidates.map((c) => ({
      userId: c.userId,
      isParticipant: invitedAtOf.has(c.userId),
      invitedAt: invitedAtOf.get(c.userId) ?? null,
      isOwningTeamLeader: leaderIds.has(c.userId),
    })),
  };
}

/**
 * 퇴사 처리 화면의 미리보기 (.pen 9-3).
 *
 * 제안만 하고 **아무것도 바꾸지 않는다** — 무확인 자동 이전은 하지 않는다(스펙 §4).
 * 후보가 없는 설문은 `proposedUserId: null` 로 나가고 화면이 「승계 대기」로 적는다.
 */
export async function previewSuccession(
  userId: string,
): Promise<{ surveys: SuccessionPlanItem[] }> {
  const owned = await loadOwnedSurveys(db, userId);

  const items = await Promise.all(
    owned.map(async (survey): Promise<SuccessionPlanItem> => {
      const { candidates, rule } = await loadSuccessionCandidates(survey.id, survey.teamId);
      const proposed = proposeSuccessor(rule);
      const proposedCandidate = candidates.find((c) => c.userId === proposed?.userId) ?? null;
      return {
        surveyId: survey.id,
        title: survey.title,
        teamName: survey.teamName,
        proposedUserId: proposed?.userId ?? null,
        proposedName: proposedCandidate?.name ?? null,
        proposedReason: proposed ? (proposed.isParticipant ? 'participant' : 'team_leader') : null,
        candidates,
      };
    }),
  );

  return { surveys: items };
}

/** 소유 설문 목록이 미리보기와 어긋난다 — 그 사이 설문이 늘거나 줄었다. */
export class SuccessionPlanMismatchError extends Error {
  constructor() {
    super('소유 설문 목록이 변경됐습니다. 다시 확인한 뒤 시도하세요.');
    this.name = 'SuccessionPlanMismatchError';
  }
}

/**
 * 확정된 승계를 적용한다 — 퇴사 트랜잭션 **안에서** 돈다.
 *
 * 상태 전이와 한 트랜잭션이어야 하는 이유는 재입사(티켓 14)와 같다: 갈라 두면 퇴사만 되고
 * 소유권 정리가 실패하는 창이 생겨, 로그인도 못 하는 사람이 설문 주인으로 남는다.
 *
 * **소유 설문 전수가 지정 목록에 있어야 한다.** 빠뜨린 설문을 조용히 승계 대기로 흘려보내면
 * 화면이 보여준 것과 실제 결과가 달라진다 — 그 차이는 재배치 인박스에서야 드러난다.
 */
export async function applySuccessionInTx(
  tx: DbTransaction,
  actorUserId: string,
  departingUserId: string,
  assignments: readonly SuccessionAssignment[],
): Promise<void> {
  const owned = await loadOwnedSurveys(tx, departingUserId);
  const ownedIds = new Set(owned.map((s) => s.id));
  const givenIds = new Set(assignments.map((a) => a.surveyId));
  if (ownedIds.size !== givenIds.size || [...ownedIds].some((id) => !givenIds.has(id))) {
    throw new SuccessionPlanMismatchError();
  }

  for (const assignment of assignments) {
    if (assignment.newOwnerUserId) {
      await transferOwnershipInTx(tx, actorUserId, assignment.surveyId, assignment.newOwnerUserId);
      continue;
    }
    // 후임 없음 — 승계 대기로 세운다. 소유자는 그대로 둔다(누가 두고 갔는지가 계보다).
    await tx
      .update(surveys)
      .set({ ownershipStatus: 'succession_pending', updatedAt: new Date() })
      .where(eq(surveys.id, assignment.surveyId));
  }
}

/** 승계 대기 설문 id — 재배치 센터가 인박스에 함께 싣는다. */
export async function listSuccessionPendingIds(): Promise<string[]> {
  const rows = await db
    .select({ id: surveys.id })
    .from(surveys)
    .where(and(eq(surveys.ownershipStatus, 'succession_pending'), isNull(surveys.deletedAt)));
  return rows.map((r) => r.id);
}

/** 재배치 센터가 여러 설문의 승계 대기를 한 번에 해소할 때 쓴다. */
export async function clearSuccessionPending(
  tx: DbTransaction,
  surveyIds: readonly string[],
): Promise<void> {
  if (surveyIds.length === 0) return;
  await tx
    .update(surveys)
    .set({ ownershipStatus: 'normal' })
    .where(inArray(surveys.id, [...surveyIds]));
}
