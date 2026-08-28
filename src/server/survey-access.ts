import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { surveyParticipants, surveys } from '@/db/schema';
import type { UserType } from '@/shared/contracts/auth';
import {
  NO_SURVEY_GUEST_TABS,
  normalizeSurveyGuestTabs,
  surveyCapabilityValues,
  type SurveyAssignmentStatus,
  type SurveyCapability,
  type SurveyGuestTabs,
  type SurveyParticipantKind,
  type SurveyVisibility,
} from '@/shared/contracts/workspace';

import { getActiveTeamMemberships } from './read-models/team-memberships';

/**
 * 설문 접근 판정 — 이 파일이 유일한 정본이다 (역할 모델 v2 티켓 07, 스펙 §8).
 *
 * data-scope.ts 의 형제로 코어 계층에 둔다. "어느 파티션을 보는가" 를 그쪽이 정하듯
 * "무엇을 할 수 있는가" 는 여기가 정한다 — 도메인마다 각자 판정하면 매트릭스가 여러 벌이 된다.
 *
 * 판정은 순수 함수(resolveSurveyCapabilities)가 하고, DB 조회는 로더(loadSurveyAccess)가
 * 한다. 관문(assertSurveyCapability)은 둘을 잇는 얇은 층이다.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 주체·대상 모양
// ─────────────────────────────────────────────────────────────────────────────

export interface SurveyAccessSubject {
  userId: string;
  isSuperadmin: boolean;
  userType: UserType;
  /** **active 팀**의 멤버십 teamId — archived 팀 멤버십은 소속이 아니다(ADR-0011). */
  activeTeamIds: readonly string[];
  /** 위 중 role='leader' 인 teamId. */
  leaderTeamIds: readonly string[];
}

export interface SurveyAccessTarget {
  teamId: string | null;
  visibility: SurveyVisibility;
  /** 2단계 배포 중이라 nullable — 백필 전 행이 소유자 없이 존재할 수 있다. */
  ownerUserId: string | null;
  assignmentStatus: SurveyAssignmentStatus;
}

/**
 * 설문 단위 초대 (survey_participants, 티켓 18).
 *
 * 이 한 줄이 **팀 경계를 넘는 유일한 통로**다 — 나머지 판정은 전부 `surveys.teamId` 를
 * 지나는데 이것만 그 축 밖에 있다. 그래서 로더가 설문 행과 **같은 쿼리에서** 읽는다:
 * 따로 조회하면 모든 관문의 왕복이 하나씩 늘고, 그 비용이 아까워 캐시를 두는 순간
 * 「초대를 뺐는데 잠깐 남아 있는」 창이 생긴다.
 */
export interface SurveyParticipation {
  kind: SurveyParticipantKind;
  /**
   * kind='guest' 의 현황 탭 화이트리스트 (티켓 21) — 다른 kind 에서는 무시된다.
   *
   * capability 집합과 **별개의 축**이다. 게스트가 갖는 capability 는 언제나 같고
   * (survey.view + operations.view), 설문마다 다른 것은 그 안에서 어느 탭이 열리는가다.
   * 탭을 capability 로 쪼개면 매트릭스 열이 설문마다 갈려 판정이 프리셋이 아니게 된다.
   */
  guestTabs?: SurveyGuestTabs | null;
}

/** 판정 결과 — capability 집합 + 게스트 전용 탭 축. */
export interface SurveyAccess {
  capabilities: ReadonlySet<SurveyCapability>;
  /** 게스트의 현황 탭 화이트리스트. null = 탭 축이 없는 주체(내부·실사). */
  guestTabs: SurveyGuestTabs | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 역할 프리셋 — 스펙 §8 표의 열
// ─────────────────────────────────────────────────────────────────────────────

const ALL_CAPABILITIES: readonly SurveyCapability[] = surveyCapabilityValues;

/**
 * 전권 — 슈퍼어드민·소유자·소유 팀 팀장이 나눠 갖는 같은 집합이다(스펙 §8 의 세 열이 동일).
 *
 * 이름을 셋으로 나누지 않는 이유는 값이 하나라서다 — 사본이 셋이면 한 열만 고쳐지고 나머지가
 * 조용히 어긋난다. 세 주체를 가르는 것은 집합이 아니라 **판정 순서**이고, 그 순서는 아래
 * resolveSurveyCapabilities 가 갖는다. v2 델타는 여기 있다: v1 은 팀장을 invite_only 에서
 * 막았지만, 팀장이 자기 팀 설문을 관리하지 못하면 승계·해산·재배치가 소유자 부재로 잠긴다.
 */
const FULL_CAPS: readonly SurveyCapability[] = ALL_CAPABILITIES;

/**
 * 참여자 — 삭제까지 받는 신뢰 수준이라 운영 깊이(응답 상세·컨택·메일·export)를 함께 준다
 * (스펙 §4 ⚠️가정, §11-1). 빠지는 것은 설문 자체의 처분권이다: 발행·공유 관리·소유권 이전,
 * 그리고 팀 소유 구조인 설문 그룹.
 */
const PARTICIPANT_CAPS: readonly SurveyCapability[] = [
  'survey.view',
  'survey.edit',
  'survey.delete',
  'survey.invite',
  'operations.view',
  'responses.view',
  'contacts.view',
  'contacts.manage',
  'contacts.writeAttempts',
  'mail.view',
  'mail.send',
  'analytics.view',
  'export.download',
];

/**
 * 팀 공개 설문의 팀원 — 만들고 고치고 현황·분석을 보되 응답자 개인 데이터(응답 상세·컨택
 * 원본·메일·export)에는 닿지 않는다. 설문 그룹은 팀 공용 구조라 팀원도 정리할 수 있다.
 */
const TEAM_MEMBER_CAPS: readonly SurveyCapability[] = [
  'survey.view',
  'survey.edit',
  'survey.invite',
  'operations.view',
  'analytics.view',
  'surveyGroup.manage',
];

/**
 * 게스트(클라이언트 발급 계정) — **부여된 설문 하나**에서 프리뷰와 허용된 현황 탭만 본다
 * (스펙 §5·§8, 티켓 21).
 *
 * 설문마다 달라지는 것은 이 집합이 아니라 `guestTabs` 다. 그래서 여기 없는 것이 곧
 * 「항상 차단」의 정본이다 — 분석·내보내기·응답 상세·컨택 원본·메일·편집. 탭 화이트리스트를
 * 아무리 열어도 이 목록이 늘지 않는 것이 계약이며, 설정 실수로 새지 않는 이유이기도 하다.
 */
const GUEST_CAPS: readonly SurveyCapability[] = ['survey.view', 'operations.view'];

const NONE: ReadonlySet<SurveyCapability> = new Set();

// ─────────────────────────────────────────────────────────────────────────────
// 판정 (순수)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이 사람이 이 설문에서 할 수 있는 일 — DB 를 만지지 않는 순수 함수.
 *
 * 순서가 곧 정책이다:
 *  1. 계정 유형 — guest 는 자기 부여 모델(티켓 21)로 갈라지고, fieldwork 는 부여 모델이
 *     붙기 전까지(티켓 24) 기본 거부다.
 *  2. 슈퍼어드민 — 전권. break-glass 감사는 관문 레이어 책임이다.
 *  3. 팀 미배치 — 초대 설문을 포함해 모든 내부 설문 차단 (CONTEXT.md 「팀 미배치 사용자」).
 *  4. 배치 대기 설문 — 슈퍼어드민 외 차단. 팀이 정해지기 전에는 소유자도 못 연다(ADR-0006).
 *  5. 소유자(**소유 팀 소속일 때만**) → 6. 소유 팀 팀장 → 7. 참여자 → 8. 팀 공개 설문의 팀원.
 *
 * invite_only 는 8번만 지운다 — "소유 팀 팀원에게만 숨김"이 v2 의 뜻이다(스펙 §3).
 *
 * **게스트는 이 사슬을 타지 않는다.** 팀 멤버십도 소유권도 없는 계정이라 4~8번이 전부
 * 무의미하고, 자격은 「이 설문에 부여됐는가」 하나뿐이다. 배치 대기만 함께 막는다 — 팀이
 * 정해지기 전에는 아무도 열 수 없다는 것이 ADR-0006 이고, 그 예외를 게스트에게 두면
 * 배치 대기 설문을 여는 유일한 사람이 클라이언트가 된다.
 *
 * 5번이 소유 팀 소속을 함께 묻는 것이 이 함수의 revocation 계약이다. 예전에는 소유자 일치만
 * 보고 FULL_CAPS 를 줬는데, 그러면 A팀 설문을 소유한 사람이 A팀에서 제외돼도 다른 팀 겸직이
 * 남아 있는 한(3번 가드는 "아무 팀에나 속했는가"만 묻는다) 그 설문의 응답·컨택·메일·export·
 * 삭제 전권을 계속 행사했다. 팀을 접근 경계로 삼는 계약이 제외로 끊기지 않으면 경계가 아니다
 * (Codex 적대적 리뷰). 설문이 고아가 되지는 않는다 — 소유 팀 팀장(6)과 슈퍼어드민(2)이
 * 언제나 남고, 소유권 이전·승계는 티켓 19 가 정식 동선을 준다.
 */
export function resolveSurveyCapabilities(
  subject: SurveyAccessSubject,
  survey: SurveyAccessTarget,
  participation?: SurveyParticipation | null,
): ReadonlySet<SurveyCapability> {
  // isSuperadmin 은 internal 전용 플래그다 — 유형 게이트가 먼저 선다.
  if (subject.userType === 'guest') {
    if (survey.assignmentStatus === 'assignment_pending') return NONE;
    return participation?.kind === 'guest' ? new Set(GUEST_CAPS) : NONE;
  }
  if (subject.userType !== 'internal') return NONE;
  if (subject.isSuperadmin) return new Set(ALL_CAPABILITIES);
  if (subject.activeTeamIds.length === 0) return NONE;
  if (survey.assignmentStatus === 'assignment_pending') return NONE;

  if (
    survey.ownerUserId !== null &&
    survey.ownerUserId === subject.userId &&
    survey.teamId !== null &&
    subject.activeTeamIds.includes(survey.teamId)
  ) {
    return new Set(FULL_CAPS);
  }
  if (survey.teamId !== null && subject.leaderTeamIds.includes(survey.teamId)) {
    return new Set(FULL_CAPS);
  }
  // 참여자는 팀 경계를 넘는다 — 소유 팀 소속이 아니어도 선다(스펙 §4).
  if (participation?.kind === 'member') return new Set(PARTICIPANT_CAPS);

  if (
    survey.visibility === 'team' &&
    survey.teamId !== null &&
    subject.activeTeamIds.includes(survey.teamId)
  ) {
    return new Set(TEAM_MEMBER_CAPS);
  }
  return NONE;
}

/**
 * capability + 게스트 탭 화이트리스트 — 판정의 완전한 결과 (순수).
 *
 * 두 축을 한 번에 돌려주는 이유는 입력이 같아서다. 탭을 따로 묻는 함수를 두면 화면 하나가
 * 판정을 두 번 하게 되고, 그 사이 부여가 바뀌면 「capability 는 있는데 탭은 없는」 어긋난
 * 조합을 본다.
 *
 * `guestTabs` 가 **null 이면 탭 축이 적용되지 않는 주체**다(내부 계정·실사). 전부 false 인
 * 객체와 갈라 두는 것이 요점이다 — 내부 계정에게 「모든 탭이 닫혔다」를 돌려주면 콘솔이
 * 자기 탭을 스스로 숨긴다.
 */
export function resolveSurveyAccess(
  subject: SurveyAccessSubject,
  survey: SurveyAccessTarget,
  participation?: SurveyParticipation | null,
): SurveyAccess {
  const capabilities = resolveSurveyCapabilities(subject, survey, participation);
  if (subject.userType !== 'guest') return { capabilities, guestTabs: null };
  // 부여가 없으면 capability 도 비어 있다 — 탭만 열린 상태는 만들지 않는다.
  const guestTabs = capabilities.has('operations.view')
    ? normalizeSurveyGuestTabs(participation?.guestTabs)
    : { ...NO_SURVEY_GUEST_TABS };
  return { capabilities, guestTabs };
}

// ─────────────────────────────────────────────────────────────────────────────
// 로더 · 관문
// ─────────────────────────────────────────────────────────────────────────────

/** 세션이 들고 있는 만큼의 주체 정보 — 멤버십은 로더가 채운다. */
export interface SurveyAccessUser {
  id: string;
  isSuperadmin: boolean;
  userType: UserType;
}

export class SurveyAccessError extends Error {
  constructor(public readonly reason: 'not_found' | 'forbidden') {
    super(reason);
    this.name = 'SurveyAccessError';
  }
}

/** 이 사람의 유효 소속을 읽어 판정 주체로 만든다. */
export async function loadAccessSubject(user: SurveyAccessUser): Promise<SurveyAccessSubject> {
  // 내부 계정이 아니면 멤버십 자체가 금지다(스펙 §1) — 조회를 아낀다.
  const memberships =
    user.userType === 'internal' ? await getActiveTeamMemberships(user.id) : [];
  return {
    userId: user.id,
    isSuperadmin: user.isSuperadmin,
    userType: user.userType,
    activeTeamIds: memberships.map((m) => m.teamId),
    leaderTeamIds: memberships.filter((m) => m.role === 'leader').map((m) => m.teamId),
  };
}

/**
 * 설문 하나에 대한 접근 판정을 DB 에서 읽어 만든다 — capability + 게스트 탭.
 *
 * 삭제된 설문(deletedAt)은 없는 것으로 본다 — 복구 경로는 티켓 17 이 자기 관문으로 연다.
 *
 * 참여 행은 **같은 쿼리에서** LEFT JOIN 으로 읽는다(티켓 18). 따로 조회하면 관문이 도는
 * 모든 표면에서 왕복이 하나씩 늘고, 그 비용을 아끼려 캐시를 두면 초대를 뺀 직후에도 잠깐
 * 통과하는 창이 생긴다.
 */
export async function loadSurveyAccess(
  user: SurveyAccessUser,
  surveyId: string,
): Promise<SurveyAccess> {
  const [row] = await db
    .select({
      teamId: surveys.teamId,
      visibility: surveys.visibility,
      ownerUserId: surveys.ownerUserId,
      assignmentStatus: surveys.assignmentStatus,
      participantKind: surveyParticipants.kind,
      guestTabs: surveyParticipants.guestTabs,
    })
    .from(surveys)
    .leftJoin(surveyParticipants, participationJoin(user.id))
    .where(and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)))
    .limit(1);
  if (!row) throw new SurveyAccessError('not_found');

  const subject = await loadAccessSubject(user);
  return resolveSurveyAccess(subject, row, toParticipation(row.participantKind, row.guestTabs));
}

/** 위의 capability 축만 필요한 호출부용 — 표면 대부분이 이쪽이다. */
export async function loadSurveyCapabilities(
  user: SurveyAccessUser,
  surveyId: string,
): Promise<ReadonlySet<SurveyCapability>> {
  return (await loadSurveyAccess(user, surveyId)).capabilities;
}

/** 설문 행에 이 사람의 참여 행을 잇는 조인 조건 — 단건·배치 로더가 같은 것을 쓴다. */
function participationJoin(userId: string) {
  return and(
    eq(surveyParticipants.surveyId, surveys.id),
    eq(surveyParticipants.userId, userId),
  );
}

/** 조인 결과(없으면 null)를 판정 입력으로 옮긴다. */
function toParticipation(
  kind: SurveyParticipantKind | null,
  guestTabs: SurveyGuestTabs | null,
): SurveyParticipation | null {
  return kind ? { kind, guestTabs } : null;
}

/**
 * capability 요구에 대한 거부 사유 — 순수 함수 (티켓 09).
 *
 * 볼 수조차 없는(survey.view 없음) 설문은 존재를 알리지 않는다: 없는 설문과 같은
 * not_found 다. 사유가 갈리면 id 스캔으로 타 팀 설문의 존재가 확인된다. forbidden 은
 * "보이는 설문에서 그 작업만 못 한다"(참여자의 발행 등)에만 쓴다. 이 구분을 호출부마다
 * 다시 쓰면 한 표면만 존재를 흘리게 되므로 여기가 유일한 정본이다.
 */
export function denialReasonFor(
  capabilities: ReadonlySet<SurveyCapability>,
  capability: SurveyCapability,
): 'not_found' | 'forbidden' | null {
  if (!capabilities.has('survey.view')) return 'not_found';
  if (!capabilities.has(capability)) return 'forbidden';
  return null;
}

/**
 * 관문 — 이 capability 가 없으면 통과시키지 않는다.
 *
 * 거부 사유는 denialReasonFor 가 정한다 — not_found 는 "없거나 볼 수 없음"(존재 은닉),
 * forbidden 은 "보이지만 그 작업 권한 없음". 화면·procedure 는 사유를 자기 표면의
 * 코드(notFound()·NOT_FOUND/FORBIDDEN)로 옮기기만 한다.
 */
export async function assertSurveyCapability(
  user: SurveyAccessUser,
  surveyId: string,
  capability: SurveyCapability,
): Promise<void> {
  const caps = await loadSurveyCapabilities(user, surveyId);
  const denial = denialReasonFor(caps, capability);
  if (denial) throw new SurveyAccessError(denial);
}

/**
 * 여러 설문의 capability 를 한 왕복으로 판정한다 (티켓 12).
 *
 * 「설문 담기」처럼 한 요청이 N 건을 검사하는 표면이 assertSurveyCapability 를 루프로 부르면
 * 설문마다 설문 행 조회 + 멤버십 조회가 따로 돈다(200건이면 400 왕복). 판정 자체는
 * resolveSurveyCapabilities 라는 **순수 함수**라, 주체를 한 번 싣고 대상 행을 한 번에 읽으면
 * 결과가 완전히 같으면서 왕복은 2회다.
 *
 * 없는 설문·삭제된 설문의 id 는 맵에 담기지 않는다 — 호출부가 `?? EMPTY` 로 받으면
 * denialReasonFor 가 not_found 를 돌려주므로 "없음" 과 "볼 수 없음" 이 같은 결론이 된다.
 */
export async function loadSurveyCapabilitiesBatch(
  user: SurveyAccessUser,
  surveyIds: readonly string[],
): Promise<Map<string, ReadonlySet<SurveyCapability>>> {
  const result = new Map<string, ReadonlySet<SurveyCapability>>();
  if (surveyIds.length === 0) return result;

  const rows = await db
    .select({
      id: surveys.id,
      teamId: surveys.teamId,
      visibility: surveys.visibility,
      ownerUserId: surveys.ownerUserId,
      assignmentStatus: surveys.assignmentStatus,
      participantKind: surveyParticipants.kind,
      guestTabs: surveyParticipants.guestTabs,
    })
    .from(surveys)
    .leftJoin(surveyParticipants, participationJoin(user.id))
    .where(and(inArray(surveys.id, [...new Set(surveyIds)]), isNull(surveys.deletedAt)));

  const subject = await loadAccessSubject(user);
  for (const row of rows) {
    result.set(
      row.id,
      resolveSurveyCapabilities(subject, row, toParticipation(row.participantKind, row.guestTabs)),
    );
  }
  return result;
}

/** 빈 capability 집합 — 존재하지 않는 설문의 판정 입력. */
const NO_CAPABILITIES: ReadonlySet<SurveyCapability> = new Set();

/**
 * 배치 관문 — 설문 전부가 요구 capability 를 **모두** 가져야 통과한다.
 *
 * 하나라도 막히면 그 자리에서 던진다. 부분 성공을 허용하면 "N개 중 3개만 담겼다" 는 상태를
 * 화면이 표현할 수 없고, 담기는 트랜잭션 하나라 실제로도 전부 아니면 전무다.
 *
 * 빈 목록은 **통과가 아니라 거부**다. 검사 루프가 0회 돌아 조용히 통과하면 단건 관문
 * (대상이 없으면 not_found)과 기본값 방향이 반대가 되고, 앞으로 입력에 `.min(1)` 을 빠뜨린
 * 표면이 하나 생기는 순간 빈 요청이 관문을 지나 서비스까지 들어간다. fail-open 은 리뷰에서
 * 눈에 띄지 않으므로 코어에서 닫는다.
 */
export async function assertSurveyCapabilityBatch(
  user: SurveyAccessUser,
  surveyIds: readonly string[],
  capabilities: readonly SurveyCapability[],
): Promise<void> {
  if (surveyIds.length === 0) throw new SurveyAccessError('not_found');

  const caps = await loadSurveyCapabilitiesBatch(user, surveyIds);
  for (const surveyId of surveyIds) {
    const own = caps.get(surveyId) ?? NO_CAPABILITIES;
    for (const capability of capabilities) {
      const denial = denialReasonFor(own, capability);
      if (denial) throw new SurveyAccessError(denial);
    }
  }
}
