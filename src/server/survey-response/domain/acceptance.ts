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
export type ReeditDenial = Exclude<AcceptanceDenial, 'max_responses_reached'>;

/** 완료 제출이 보는 부분집합 — 마감은 신규 접수만 막으므로 빠진다. */
export type CompleteDenial = Exclude<AcceptanceDenial, 'end_date_passed'>;

/** 진행 중 응답 계속이 보는 부분집합. */
export type OngoingDenial = Extract<AcceptanceDenial, 'survey_paused'>;

// 판정이 읽는 상태(이미 조회된 행의 구조적 부분집합). 어느 쿼리로 읽었는지는 묻지 않는다.

export interface SurveyAcceptanceState {
  status: string;
  isPaused: boolean;
  endDate: Date | null;
  maxResponses: number | null;
  isPublic: boolean;
  requireInviteToken: boolean;
}

/** reedit 의 tx select(6컬럼)가 구조적으로 만족. */
export type ReeditSurveyState = Pick<
  SurveyAcceptanceState,
  'status' | 'isPaused' | 'endDate' | 'isPublic' | 'requireInviteToken'
>;

/**
 * 완료 게이트가 읽는 상태. endDate 가 없다 — 완료는 마감을 보지 않는다는 정책이
 * 타입에 박혀 있어, 나중에 누가 마감을 다시 넣으려면 여기부터 고쳐야 한다.
 */
export type CompleteSurveyState = Pick<
  SurveyAcceptanceState,
  'status' | 'isPaused' | 'maxResponses' | 'isPublic' | 'requireInviteToken'
>;

/** getSurveyControlFlags 반환(SurveyControlFlags)이 구조적으로 만족. */
export type OngoingSurveyState = Pick<SurveyAcceptanceState, 'isPaused'>;

/** 판정 대상 버전 행. 어떤 버전을 넘길지는 호출자 결정(응답 고정 버전 vs 설문 currentVersionId). */
export type VersionAcceptanceState = { status: string } | null;

// ========================
// 이하 비공개 — 우선순위와 검사 집합의 단일 소유자.
// ========================

/**
 * 판정 순서. **외부 관측 가능한 계약이다** — 위반이 여럿일 때 첫 사유가
 * toGateBlockReason 을 거쳐 응답자 화면 문구를 정한다(status/endDate/max → not_accepting,
 * paused → survey_paused, invite → invalid_token). 정렬·재배치 금지.
 * 서비스 어댑터(assertSurveyAcceptingResponses / assertResponseCompletable /
 * assertSurveyNotPaused / allowReeditResponse)가 모두 이 순서를 따른다.
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
   * 신규 진입 — 마감된 설문에 새로 들어오는 것은 막는다. endDate 의 본래 뜻이 여기다.
   * 정원은 completedCount 를 넘긴 호출자만 하드체크한다 — create 시점은 넘기지 않아
   * soft(검사 생략)이고 잔여 race window 는 완료 게이트가 보강한다.
   * createBlankResponse 도 이 행을 쓴다(수용된 갭): 답변을 하나도 쓰지 않은 진입이라
   * 마감으로 잘려도 잃는 노동이 정의상 0 이고, 완료 정책으로 옮기면 마감 후 신규 진입이
   * 그대로 뚫린다.
   */
  newResponse: [
    'status_not_published',
    'survey_paused',
    'end_date_passed',
    'max_responses_reached',
    'invite_required',
  ],
  /**
   * 제출 완료 — 마감(end_date_passed) 미검사(의도). endDate 는 새 응답 접수를 마감하는
   * 것이지 이미 진행 중인 응답을 몰수하는 것이 아니다. 마감 시각에 걸친 응답자는 끝까지
   * 진행해 저장된다(ongoingResponse 와 같은 결정).
   * 정원·중단은 계속 차단한다 — 정원을 넘기면 표본이 망가지고, 중단은 운영자가 "지금
   * 아무것도 들어오지 마라"고 건 라이브 스위치라 진행 중 응답에도 적용된다.
   * 정원은 이 행에서만 하드체크다(completedCount 필수 인자).
   * 부수 효과: 지금까지는 CHECK_ORDER 상 마감이 정원보다 앞이라 마감 후 완료 시도가 항상
   * 마감에서 먼저 잘려 정원 검사에 도달하지 않았다. 마감을 빼면 정원 검사가 처음으로
   * 활성화되어 사유가 end_date_passed → max_responses_reached 로 승계된다. 어느 쪽도 차단이라
   * 정책 회귀가 아니다. 다만 완료 경로는 blocked 폴딩을 타지 않으므로 두 사유 모두
   * 응답자에게는 500 으로 나간다 — 사유 태그만 바뀐다.
   */
  completeResponse: [
    'status_not_published',
    'survey_paused',
    'max_responses_reached',
    'invite_required',
  ],
  /**
   * 진행 중 응답 계속 — 중단만 본다.
   * status·endDate 미검사는 근거 있는 선택이다: 진행 중 응답은 몰수하지 않는다
   * (completeResponse 와 같은 결정). 첫 진입 게이트는 newResponse 소관이고, 종결 상태
   * 판정은 호출자 resumeOrCreateResponse 의 인라인 concludedStatuses 가 진다 —
   * 통합은 후속 티켓(A-3).
   * 정원 미검사도 같은 이유 — 진행 중인 응답을 중간에 잘라내지 않고 완료 시점에 판정한다.
   */
  ongoingResponse: ['survey_paused'],
  /**
   * 재응답 허용 — 관리자가 완료 응답을 되돌린다.
   * 정원 미검사(의도) — 되돌리기 자체가 완료 슬롯 하나를 비우므로 재완료는 자기 슬롯 회수다.
   * invite 검사(의도) — 되돌리기의 목적은 응답자가 초대 링크로 재진입해 재제출하는 것이라,
   * 연결된 조사 대상이 없으면 강등만 되고 재제출 경로가 없는 고아 상태가 된다. 되돌리기는
   * 통과시키면서 재제출은 막는 비대칭을 없앤다.
   * status·endDate 는 계속 본다 — 되돌리기는 이미 닫힌 접수를 관리자가 다시 여는 행위라
   * 진행 중 응답을 지키는 것과 성격이 다르다.
   */
  reedit: [
    'status_not_published',
    'survey_paused',
    'end_date_passed',
    'invite_required',
  ],
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

// ========================
// 공개 표면 — 도메인 질문 4개. 시그니처가 곧 부분집합 명세다.
// ========================

/**
 * 신규 응답을 받는가 — startResponse / createResponseWithFirstAnswer / createBlankResponse.
 * completedCount 는 넘기지 않는다(create 시점 정원은 soft). 완료 시점 하드체크는
 * completeResponseDenial 소관이다.
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
 * 제출 완료를 받는가 — completeResponse.
 * newResponse 와 유일하게 갈리는 지점은 마감이다(CHECKS_FOR.completeResponse 주석 참조).
 * 정원은 여기서만 하드체크라 completedCount 가 선택이 아닌 필수 인자다.
 */
export function completeResponseDenial(
  survey: CompleteSurveyState,
  version: VersionAcceptanceState,
  opts: {
    contactTargetId: string | null;
    completedCount: number;
    /** 응답 행 isTest 면 전 검사 면제. */
    isTest: boolean;
    now?: number;
  },
): CompleteDenial | null {
  return evaluate(
    {
      isTest: opts.isTest,
      now: opts.now ?? Date.now(),
      status: survey.status,
      versionStatus: version?.status ?? null,
      isPaused: survey.isPaused,
      maxResponses: survey.maxResponses,
      completedCount: opts.completedCount,
      isPublic: survey.isPublic,
      requireInviteToken: survey.requireInviteToken,
      contactTargetId: opts.contactTargetId,
    },
    CHECKS_FOR.completeResponse,
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
 *
 * contactTargetId 는 호출자가 **양방향으로 해석한** 앵커여야 한다. 응답 행의
 * contact_target_id(정방향)만 보면 레거시 행(역방향만 연결)이 초대 없음으로 오판된다 —
 * 서비스의 resolveContactAnchor 결과를 넘길 것.
 */
export function reeditDenial(
  survey: ReeditSurveyState,
  version: VersionAcceptanceState,
  opts: { contactTargetId: string | null; isTest: boolean; now?: number },
): ReeditDenial | null {
  return evaluate(
    {
      isTest: opts.isTest,
      now: opts.now ?? Date.now(),
      status: survey.status,
      versionStatus: version?.status ?? null,
      isPaused: survey.isPaused,
      endDate: survey.endDate,
      isPublic: survey.isPublic,
      requireInviteToken: survey.requireInviteToken,
      contactTargetId: opts.contactTargetId,
    },
    CHECKS_FOR.reedit,
  );
}
