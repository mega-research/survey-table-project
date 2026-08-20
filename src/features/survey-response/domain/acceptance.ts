// 수용 게이트 — "이 설문이 지금 응답을 받는가" 판정의 단일 거처(순수).
// db·server-only 를 import 하지 않는다. 행 조회와 에러 변환은 호출자(service) 소유.
// 선례: decideResponseReuse(domain/lifecycle.ts), toGateBlockReason(domain/gate-block-reason.ts)

/**
 * 수용 거부 사유. **문자열 값 자체가 외부 계약이다.**
 * - SurveyNotAcceptingResponsesError.reason (→ toGateBlockReason → 응답자 화면 BlockReason)
 * - ReeditUnavailableError.reason (→ procedures/manage.ts 의 REEDIT_UNAVAILABLE_MESSAGE 키)
 * 값 변경 금지.
 */
export type AcceptanceDenial =
  | 'status_not_published'
  | 'survey_paused'
  | 'end_date_passed'
  | 'max_responses_reached'
  | 'invite_required';

/** 재응답 허용이 보는 부분집합 — ReeditUnavailableError 생성자 인자 union 과 정확히 동일. */
export type ReeditDenial = Exclude<
  AcceptanceDenial,
  'max_responses_reached' | 'invite_required'
>;

/** 진행 중 응답 계속이 보는 부분집합. */
export type OngoingDenial = Extract<AcceptanceDenial, 'survey_paused'>;

// ── 판정이 읽는 상태(이미 조회된 행의 구조적 부분집합). 어느 쿼리로 읽었는지는 묻지 않는다. ──

export interface SurveyAcceptanceState {
  status: string;
  isPaused: boolean;
  endDate: Date | null;
  maxResponses: number | null;
  isPublic: boolean;
  requireInviteToken: boolean;
}

/** reedit 의 tx select(4컬럼)가 구조적으로 만족. */
export type ReeditSurveyState = Pick<SurveyAcceptanceState, 'status' | 'isPaused' | 'endDate'>;

/** getSurveyControlFlags 반환(SurveyControlFlags)이 구조적으로 만족. */
export type OngoingSurveyState = Pick<SurveyAcceptanceState, 'isPaused'>;

/** 판정 대상 버전 행. 어떤 버전을 넘길지는 호출자 결정(응답 고정 버전 vs 설문 currentVersionId). */
export type VersionAcceptanceState = { status: string } | null;

// ══════════════════════════════════════════════════════════════════
// 이하 비공개 — 우선순위와 검사 집합의 단일 소유자.
// ══════════════════════════════════════════════════════════════════

/**
 * 판정 순서. **외부 관측 가능한 계약이다** — 위반이 여럿일 때 첫 사유가
 * toGateBlockReason 을 거쳐 응답자 화면 문구를 정한다(status/endDate/max → not_accepting,
 * paused → survey_paused, invite → invalid_token). 정렬·재배치 금지.
 * 현행 두 구현(assertSurveyAcceptingResponses / allowReeditResponse)의 순서와 동일하다.
 */
const CHECK_ORDER = [
  'status_not_published',
  'survey_paused',
  'end_date_passed',
  'max_responses_reached',
  'invite_required',
] as const satisfies readonly AcceptanceDenial[];

/**
 * 도메인 질문별 검사 집합 — 수용 정책 전체가 이 표 하나다.
 * 표에서 빠진 검사는 "안 보기로 한 것"이며 각 행 주석이 근거를 진다.
 * 순서는 이 배열이 아니라 CHECK_ORDER 가 소유한다.
 */
const CHECKS_FOR = {
  /**
   * 정원은 completedCount 를 넘긴 호출자(complete)만 하드체크한다 — create 시점은
   * completedCount 를 넘기지 않아 soft(검사 생략)이고 잔여 race window 는 수용한다.
   */
  newResponse: [
    'status_not_published',
    'survey_paused',
    'end_date_passed',
    'max_responses_reached',
    'invite_required',
  ],
  /**
   * 중단만 본다. 첫 진입 게이트는 newResponse 소관이고 종결 상태 판정은
   * decideResponseReuse 소관이다.
   * status·endDate 미검사 — 근거 주석 없음. 현행 동작 보존이며 정책 판단은 후속 티켓(B-b).
   */
  ongoingResponse: ['survey_paused'],
  /**
   * 정원 미검사(의도) — 되돌리기 자체가 완료 슬롯 하나를 비우므로 재완료는 자기 슬롯 회수다.
   * invite 미검사 — 근거 주석 없음. 현행 동작 보존이며 정책 판단은 후속 티켓(B-a).
   */
  reedit: ['status_not_published', 'survey_paused', 'end_date_passed'],
} as const satisfies Record<string, readonly AcceptanceDenial[]>;

/**
 * 검사가 읽는 사실. 선택되지 않은 검사의 필드는 조립되지 않는다.
 * 불변식: 각 공개 함수의 state 파라미터 타입이, 그 함수가 고른 검사가 읽는 필드의
 * 존재를 정적으로 보장한다(그래서 아래 술어는 선택된 경우에만 호출된다).
 */
interface AcceptanceFacts {
  isTest: boolean;
  now: number;
  status?: string;
  versionStatus?: string | null;
  isPaused?: boolean;
  endDate?: Date | null;
  maxResponses?: number | null;
  completedCount?: number | null;
  isPublic?: boolean;
  requireInviteToken?: boolean;
  contactTargetId?: string | null;
}

/** 검사 본문 — 각 규칙은 여기 1회만 존재한다. true = 위반. */
const PREDICATES: Record<AcceptanceDenial, (f: AcceptanceFacts) => boolean> = {
  // 설문 자체가 published 이거나, 판정 대상 version 이 published 여야 한다.
  status_not_published: (f) => f.status !== 'published' && f.versionStatus !== 'published',
  survey_paused: (f) => f.isPaused === true,
  // null = 무제한, 경계는 <= (endDate === now 는 거부).
  end_date_passed: (f) => f.endDate != null && f.endDate.getTime() <= f.now,
  // completedCount 미전달(create 시점) = soft — 검사 생략.
  max_responses_reached: (f) =>
    f.maxResponses != null && f.completedCount != null && f.completedCount >= f.maxResponses,
  // checkTrackA 가 inviteToken 유효성을 별도 검증하므로 여기서는 contactTargetId 매칭 유무만 본다.
  invite_required: (f) =>
    (f.isPublic === false || f.requireInviteToken === true) && f.contactTargetId == null,
};

/**
 * 선택된 검사를 CHECK_ORDER 순서로 돌려 첫 위반을 돌려준다.
 * isTest 는 전 검사 면제 — 호출자에 흩어져 있던 예외 규칙의 단일 거처다(스펙 5절:
 * 운영자가 중단·마감 중에도 테스트 링크로 미리보기/QA 할 수 있어야 한다).
 * 제네릭 D 로 반환 union 이 checks 만큼 좁아져 호출부에 캐스트가 필요 없다.
 */
function evaluate<D extends AcceptanceDenial>(
  facts: AcceptanceFacts,
  checks: readonly D[],
): D | null {
  if (facts.isTest) return null;
  for (const id of CHECK_ORDER) {
    const selected = checks.find((c) => c === id);
    if (selected === undefined) continue;
    if (PREDICATES[selected](facts)) return selected;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// 공개 표면 — 도메인 질문 3개. 시그니처가 곧 부분집합 명세다.
// ══════════════════════════════════════════════════════════════════

/**
 * 신규 응답을 받는가 — startResponse / createResponseWithFirstAnswer /
 * createBlankResponse / completeResponse.
 * completedCount 를 넘긴 호출자(complete)만 정원 하드체크를 받는다.
 */
export function newResponseDenial(
  survey: SurveyAcceptanceState,
  version: VersionAcceptanceState,
  opts: {
    contactTargetId: string | null;
    completedCount?: number | null;
    /** 응답 행 isTest 또는 유효 테스트 링크 세션이면 전 검사 면제. */
    isTest: boolean;
    now?: number;
  },
): AcceptanceDenial | null {
  return evaluate(
    {
      isTest: opts.isTest,
      now: opts.now ?? Date.now(),
      status: survey.status,
      versionStatus: version?.status ?? null,
      isPaused: survey.isPaused,
      endDate: survey.endDate,
      maxResponses: survey.maxResponses,
      completedCount: opts.completedCount ?? null,
      isPublic: survey.isPublic,
      requireInviteToken: survey.requireInviteToken,
      contactTargetId: opts.contactTargetId,
    },
    CHECKS_FOR.newResponse,
  );
}

/**
 * 이미 시작된 응답을 계속 진행할 수 있는가 — 재진입(resume) + 답변 저장(update/draft).
 * 중단(라이브 컬럼)만 본다.
 */
export function ongoingResponseDenial(
  survey: OngoingSurveyState,
  opts: { isTest: boolean },
): OngoingDenial | null {
  return evaluate(
    { isTest: opts.isTest, now: Date.now(), isPaused: survey.isPaused },
    CHECKS_FOR.ongoingResponse,
  );
}

/**
 * 완료 응답을 되돌릴 수 있는가 — allowReeditResponse.
 * 반환 union 이 ReeditUnavailableError 생성자 인자와 동치라 캐스트가 필요 없다.
 */
export function reeditDenial(
  survey: ReeditSurveyState,
  version: VersionAcceptanceState,
  opts: { isTest: boolean; now?: number },
): ReeditDenial | null {
  return evaluate(
    {
      isTest: opts.isTest,
      now: opts.now ?? Date.now(),
      status: survey.status,
      versionStatus: version?.status ?? null,
      isPaused: survey.isPaused,
      endDate: survey.endDate,
    },
    CHECKS_FOR.reedit,
  );
}
