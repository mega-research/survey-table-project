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
  TransferSurveyOwnershipInput,
  WorkspaceActionOutput,
} from '@/shared/contracts/workspace-io';

import {
  AmbiguousOwnerTeamError,
  NotATransferCandidateError,
  OwnerHasNoTeamError,
  OwnerTeamNotActiveError,
  OwnershipChangedError,
  OwnershipSurveyNotFoundError,
  SelfTransferError,
  type SuccessionCandidate,
  proposeSuccessor,
} from '../domain/succession';
import { lockTeamMembers } from './members';

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
  executor: DbTransaction | typeof db = db,
): Promise<ListTransferCandidatesOutput> {
  // FROM 은 users 이고 설문은 **한 행짜리 조인**이다. 반대로 두면 users 와의 조인 조건이
  // 없어 전 사용자 카테시안이 만들어진 뒤 WHERE 로 걸러진다.
  //
  // 실행자를 받는 이유는 이 조회가 **잠금 안에서도** 불리기 때문이다(수동 이전의 후보 재확인).
  // `db` 로 고정하면 잠긴 설문 행을 다른 스냅샷으로 다시 읽어, 후보 판정과 팀 판정이 서로
  // 다른 상태를 볼 수 있다(티켓 15 「조회는 조건이지 사후 확인이 아니다」와 같은 축).
  const rows = await executor
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
async function readActiveMembershipTeamIds(
  tx: DbTransaction,
  userId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(teams, and(eq(teams.id, teamMembers.teamId), eq(teams.status, 'active')))
    .where(eq(teamMembers.userId, userId));
  return rows.map((r) => r.teamId);
}

type OwningTeamPick =
  | { ok: true; teamId: string }
  | { ok: false; reason: 'no_team' | 'ambiguous' };

/**
 * 위 세 갈래를 **값으로만** 판정한다.
 *
 * 던지지 않고 결과를 돌려주는 이유는 이 규칙이 두 번 돌기 때문이다 — 한 번은 잠그기 전
 * (어느 팀을 잠글지 고르려고), 한 번은 잠근 뒤(판정하려고). 앞의 것이 던지면 잠금 밖에서
 * 읽은 값으로 사용자에게 사유를 말하게 된다. **사유는 언제나 잠근 값에서 나와야 한다.**
 */
function pickOwningTeam(
  surveyTeamId: string | null,
  membershipTeamIds: string[],
): OwningTeamPick {
  if (surveyTeamId && membershipTeamIds.includes(surveyTeamId)) {
    return { ok: true, teamId: surveyTeamId };
  }
  if (membershipTeamIds.length === 0) return { ok: false, reason: 'no_team' };
  if (membershipTeamIds.length > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: true, teamId: membershipTeamIds[0]! };
}

function requireOwningTeam(pick: OwningTeamPick): string {
  if (pick.ok) return pick.teamId;
  throw pick.reason === 'no_team' ? new OwnerHasNoTeamError() : new AmbiguousOwnerTeamError();
}

/**
 * 잠글 팀을 고르기 위한 **사전 읽기** — 판정에 쓰지 않는다.
 *
 * 잠금 순서를 「팀 → 설문」으로 맞추려면 설문 행을 잠그기 전에 팀 id 를 알아야 하는데, 그
 * 값의 출처가 설문 행이라 순환이다. 그래서 잠그지 않고 한 번 읽어 **후보 집합**만 만들고,
 * 진짜 판정은 전부 잠근 뒤에 다시 한다. 여기서 읽은 값이 틀렸어도 안전한 이유는 잠근 뒤의
 * 재판정이 후보 집합 밖의 답을 `OwnershipChangedError` 로 접기 때문이다(재시도가 정답).
 */
async function planTeamLocks(
  tx: DbTransaction,
  surveyId: string,
  newOwnerUserId: string,
): Promise<string[]> {
  const [pre] = await tx
    .select({ teamId: surveys.teamId })
    .from(surveys)
    .where(and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)));
  if (!pre) throw new OwnershipSurveyNotFoundError();

  const pick = pickOwningTeam(pre.teamId, await readActiveMembershipTeamIds(tx, newOwnerUserId));
  const ids = [pre.teamId, pick.ok ? pick.teamId : null].filter(
    (id): id is string => id !== null,
  );
  // **id 오름차순** — 해산(dissolveTeam)·재배치(assignSurveys)·담기와 같은 순서다. 입력
  // 순서로 잠그면 두 이전이 서로 반대 방향으로 겹칠 때 사이클이 생긴다.
  return [...new Set(ids)].sort();
}

/**
 * 팀 명부와 팀 행을 **설문보다 먼저** 잠근다 — 순서가 이 함수의 존재 이유다.
 *
 * 해산(`dissolveTeam`)과 재배치(`assignSurveys`)가 「팀 명부 advisory → 팀 행 → 설문 행」으로
 * 잠근다. 이전만 「설문 행 → 팀」이면 그 둘과 정확히 반대라, 겹치는 순간 데드락이다(Postgres
 * 가 감지해 한쪽을 중단시키므로 데이터가 깨지지는 않지만, 운영자에게는 이유 없는 실패다).
 *
 * 팀 행을 `FOR SHARE` 로 잡는 것은 해산의 `FOR NO KEY UPDATE` 와 충돌시키기 위해서다 —
 * 해산이 진행 중이면 여기서 기다렸다가 archived 를 보고 거부한다(ADR-0011).
 * **여기서는 활성 여부를 판정하지 않는다**: 어느 팀이 목적지인지는 설문을 잠근 뒤에야
 * 확정되므로, 판정은 `assertLockedTeamActive` 가 그때 한다.
 */
async function lockTeamsBeforeSurvey(
  tx: DbTransaction,
  teamIds: readonly string[],
): Promise<Set<string>> {
  const active = new Set<string>();
  for (const teamId of teamIds) {
    await lockTeamMembers(tx, teamId);
    const [team] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.status, 'active')))
      .for('share');
    if (team) active.add(team.id);
  }
  return active;
}

/**
 * 소유권 이전의 트랜잭션 본문 — 수동 이전(공유 모달)과 승계(퇴사 처리)가 **같은 자리**를 쓴다.
 *
 * 나누지 않는 이유는 불변식이 하나이기 때문이다: 소유자는 소유 팀 사람이어야 하고, 팀이
 * 움직이면 그룹은 미분류로 내려가야 한다(티켓 12 인계). 두 벌이면 한쪽만 조여진다.
 *
 * **잠금 순서가 이 함수의 뼈대다 — 전역 전이 키 → 팀 명부 → 팀 행 → 설문 행.**
 * 해산·재배치와 같은 순서이고, 자격 판정(대상 상태·후보·소속)은 **전부 마지막 잠금 뒤**에
 * 선다. 앞에 두면 잠금 밖에서 읽은 값으로 판정하게 되고, 그 사이 커밋된 제외·퇴사·해산을
 * 못 본다.
 */
export async function transferOwnershipInTx(
  tx: DbTransaction,
  actorUserId: string,
  surveyId: string,
  newOwnerUserId: string,
  options: { expectedOwnerUserId?: string | null } = {},
): Promise<void> {
  // ① 전역 전이 키. 아래에서 대상의 `users.status` 를 읽는데 그 값을 바꾸는 것은 퇴사·정지
  //    (applyUserStatusChange)이고 그쪽은 이 키를 잡고 돈다. 키 없이 읽으면 「이전은 성공했는데
  //    소유자가 그 순간 퇴사」가 되어, 승계 대기로도 안 잡히는 고아가 남는다.
  //    **가장 먼저** 잡는 것이 계약이다 — 퇴사가 「전역 키 → …」 순서라, 여기서 뒤에 잡으면
  //    반대 순서가 된다. advisory xact 락은 재진입이 안전해 이미 키를 쥔 퇴사는 그대로 통과한다.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('user-status-transition')::bigint)`);

  // ② 팀 명부 · 팀 행 — 설문보다 먼저. 어느 팀을 잠글지는 잠그지 않은 사전 읽기로 고르고,
  //    그 선택이 틀렸을 가능성은 ④의 재판정이 받는다.
  const lockedTeamIds = await planTeamLocks(tx, surveyId, newOwnerUserId);
  const activeTeamIds = await lockTeamsBeforeSurvey(tx, lockedTeamIds);

  // ③ 설문 행.
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

  // 잠긴 값과 대조한다 — 이것이 「동시 요청 중 하나만 성공」을 만든다. FOR UPDATE 는 두 요청을
  // 줄 세울 뿐이라, 대조가 없으면 서로 다른 후임을 지목한 둘이 모두 성공하고 나중 것이 이긴다.
  // 승계는 토큰이 없다(옵션 미전달) — 퇴사 트랜잭션이 소유 설문 전수를 이미 대조했다.
  if (
    options.expectedOwnerUserId !== undefined &&
    survey.ownerUserId !== options.expectedOwnerUserId
  ) {
    throw new OwnershipChangedError();
  }
  if (survey.ownerUserId === newOwnerUserId) throw new SelfTransferError();

  // ④ 여기서부터가 판정이다 — 전부 잠긴 값으로 본다.
  //
  // 목적지 팀을 다시 고른다. 이것이 없으면 멤버십을 읽은 뒤 잠금을 얻기 전에 커밋된
  // `removeMember`(같은 팀 키를 쓴다)를 못 보고, 소유 팀 밖 사람을 소유자로 앉힌다 — 그
  // 설문은 소유자조차 못 열고(티켓 13 revocation) 소유자가 살아 있어 승계 대기로도 안 잡혀
  // 재배치 인박스에도 안 뜬다.
  const teamId = requireOwningTeam(
    pickOwningTeam(survey.teamId, await readActiveMembershipTeamIds(tx, newOwnerUserId)),
  );

  // 사전 읽기가 고른 집합 밖의 팀이 답이면 **그 팀의 명부는 아직 잠겨 있지 않다** — 여기서
  // 그대로 진행하면 잠금이 지켜주지 못하는 값으로 쓰게 된다. 재시도가 정답이다
  // (다음 시도의 사전 읽기는 바뀐 값을 본다).
  if (!lockedTeamIds.includes(teamId)) throw new OwnershipChangedError();
  if (survey.teamId !== null && !lockedTeamIds.includes(survey.teamId)) {
    throw new OwnershipChangedError();
  }
  // 해산이 진행 중이었다면 ②에서 기다렸다가 archived 를 봤다 — 그 결과로 판정한다.
  if (!activeTeamIds.has(teamId)) throw new OwnerTeamNotActiveError();

  const [target] = await tx
    .select({ status: users.status, userType: users.userType })
    .from(users)
    .where(eq(users.id, newOwnerUserId));
  if (!target || target.status !== 'active' || target.userType !== 'internal') {
    throw new NotATransferCandidateError();
  }

  // **후보 자격은 수동 이전과 승계 양쪽 다 요구한다.**
  //
  // 예전에는 승계를 면제하며 "처리자가 목록에서 고른 사람이라 다시 물으면 왕복만 는다" 고
  // 적어 뒀는데, 그 목록은 서버가 만든 것이 아니라 **클라이언트가 보내는 입력**이다. 면제하면
  // 같은 팀 사람도 참여자도 아닌 임의의 active internal 계정을 지목할 수 있고, 그 사람에게
  // 활성 팀이 하나면 설문이 그 무관한 팀으로 **조용히** 옮겨간다.
  // 악의가 없어도 재현된다 — 미리보기와 확정 사이에 후보가 팀에서 빠지면 같은 일이 벌어진다.
  const candidates = await listTransferCandidates(surveyId, tx);
  if (!candidates.some((c) => c.userId === newOwnerUserId)) {
    throw new NotATransferCandidateError();
  }

  const movedTeam = teamId !== survey.teamId;

  await tx
    .update(surveys)
    .set({
      ownerUserId: newOwnerUserId,
      teamId,
      // 팀이 움직이면 그룹은 미분류로 내려간다 — 그룹은 팀 소유물이다(0117 헤더의 계약).
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
      expectedOwnerUserId: input.expectedOwnerUserId,
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
 * 퇴사 처리 화면의 미리보기 (.pen 9-3).
 *
 * 제안만 하고 **아무것도 바꾸지 않는다** — 무확인 자동 이전은 하지 않는다(스펙 §4).
 * 후보가 없는 설문은 `proposedUserId: null` 로 나가고 화면이 「승계 대기」로 적는다.
 *
 * 참여 행과 팀장은 **설문 수와 무관하게 각각 한 번씩** 읽는다. 설문마다 조회하면 소유 설문이
 * 수십 건인 사람을 처리할 때 그만큼 왕복이 늘고, 퇴사 모달은 그 왕복이 끝나야 열린다.
 * 후보 목록만 설문별로 남는다 — 조건(소유 팀 · 그 설문의 참여자)이 설문마다 다르다.
 */
export async function previewSuccession(
  userId: string,
): Promise<{ surveys: SuccessionPlanItem[] }> {
  const owned = await loadOwnedSurveys(db, userId);
  if (owned.length === 0) return { surveys: [] };

  const surveyIds = owned.map((s) => s.id);
  const teamIds = [
    ...new Set(owned.map((s) => s.teamId).filter((id): id is string => id !== null)),
  ];

  const [participantRows, leaderRows, candidateLists] = await Promise.all([
    db
      .select({
        surveyId: surveyParticipants.surveyId,
        userId: surveyParticipants.userId,
        invitedAt: surveyParticipants.createdAt,
      })
      .from(surveyParticipants)
      .where(
        and(inArray(surveyParticipants.surveyId, surveyIds), eq(surveyParticipants.kind, 'member')),
      ),
    teamIds.length > 0
      ? db
          .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
          .from(teamMembers)
          .innerJoin(teams, and(eq(teams.id, teamMembers.teamId), eq(teams.status, 'active')))
          .where(and(inArray(teamMembers.teamId, teamIds), eq(teamMembers.role, 'leader')))
      : Promise.resolve([] as { teamId: string; userId: string }[]),
    Promise.all(owned.map((survey) => listTransferCandidates(survey.id))),
  ]);

  const invitedAtOf = new Map(
    participantRows.map((r) => [`${r.surveyId}:${r.userId}`, r.invitedAt]),
  );
  const leadersOf = new Map<string, Set<string>>();
  for (const row of leaderRows) {
    const set = leadersOf.get(row.teamId) ?? new Set<string>();
    set.add(row.userId);
    leadersOf.set(row.teamId, set);
  }

  const surveysOut = owned.map((survey, index): SuccessionPlanItem => {
    const candidates = candidateLists[index]!;
    const leaders = (survey.teamId && leadersOf.get(survey.teamId)) || new Set<string>();
    const rule: SuccessionCandidate[] = candidates.map((c) => ({
      userId: c.userId,
      isParticipant: invitedAtOf.has(`${survey.id}:${c.userId}`),
      invitedAt: invitedAtOf.get(`${survey.id}:${c.userId}`) ?? null,
      isOwningTeamLeader: leaders.has(c.userId),
    }));

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
  });

  return { surveys: surveysOut };
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

  // **id 오름차순으로 돈다.** 입력 순서(클라이언트가 정한다)로 잠그면 재배치·해산·담기가
  // 쓰는 순서와 어긋나 두 경로가 2건 이상 겹칠 때 사이클이 생긴다. `owned` 는 이미 정렬돼
  // 있으므로 그것을 순서의 정본으로 삼는다.
  const byId = new Map(assignments.map((a) => [a.surveyId, a]));
  for (const survey of owned) {
    const assignment = byId.get(survey.id)!;
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
