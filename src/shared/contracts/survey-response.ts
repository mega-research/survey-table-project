// 응답 계약 — survey_responses.page_visits·status, response_edit_logs.changed_questions.
// DB 스키마($type<>)·서버·UI 가 공유하는 어휘 — 런타임 의존 없음(리터럴 상수·순수 술어 제외).

/**
 * response_edit_logs.changed_questions 항목.
 * 바뀐 질문의 버전 스냅샷 기준 식별 정보. 기록 시점에 스냅샷 저장돼
 * 이후 빌더에서 질문 제목이 바뀌어도 당시 값이 보존된다.
 */
export interface ResponseEditChange {
  questionId: string;
  /** SPSS 변수명/문항코드. 스냅샷에 없으면 null. */
  code: string | null;
  /** 문항 제목. 스냅샷에 없으면 questionId 로 폴백. */
  title: string;
}

// 운영 현황 콘솔 — 응답 페이지 방문 기록
export interface PageVisit {
  stepId: string;
  enteredAt: string;
  leftAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// survey_responses.status — 응답 상태 어휘 (SSOT)
// ─────────────────────────────────────────────────────────────────────────────
//
// text 컬럼이라 DB 제약은 없다. 값 집합과 열림/종결 구분은 이 모듈이 유일한 출처이며
// 스키마($type)·domain(z.enum)·service 판정·운영 집계가 여기서 파생한다.
//
// 전이(앱 코드 기준):
//   in_progress ──(완료 제출)──────────────────▶ completed
//   in_progress ──(완료 제출 + 자격미달 판정)──▶ screened_out
//   in_progress ──(3h 유휴 sweep_stale_sessions)──▶ drop ──(재진입 되살리기)──▶ in_progress
//   in_progress ──(쿼터 마감 markQuotaFull)────▶ quotaful_out
//   completed   ──(운영 콘솔 재응답 허용)──────▶ in_progress
//
// screened_out 은 완료 확정과 같은 지점에서 갈린다 — 자격미달 end 규칙이 매칭되면
// completeResponse 가 completed 대신 이 값을 쓴다(response-completion.service).
// 판정 자체는 survey-response/domain/screen-out 소관이다.
// bad 만 앱 코드가 직접 쓰지 않는 종결값이다(운영·SQL 경로 예약).

/** survey_responses.status 전체 값. 순서는 스키마 주석·ResumeStatusSchema 와 같다. */
export const responseStatusValues = [
  'in_progress',
  'completed',
  'screened_out',
  'quotaful_out',
  'bad',
  'drop',
] as const;
export type ResponseStatus = (typeof responseStatusValues)[number];

/**
 * 열린 상태 — 새 답을 받을 수 있는 행. `drop` 은 종결이 아니다: sweep 이 is_completed 를
 * false 로 남긴 채 바꾼 값이라, 재진입 시 in_progress 로 되살려 이어간다.
 */
export const openResponseStatusValues = ['in_progress', 'drop'] as const;
export type OpenResponseStatus = (typeof openResponseStatusValues)[number];

/**
 * 종결 상태 — 새 답을 받지 않는 행. 테스트 세션에서만 "처음부터 다시"(restart) 가 허용된다.
 * 알 수 없는 값을 여기에 흘리지 않기 위한 화이트리스트다.
 */
export const concludedResponseStatusValues = [
  'completed',
  'screened_out',
  'quotaful_out',
  'bad',
] as const;
export type ConcludedResponseStatus = (typeof concludedResponseStatusValues)[number];

/** 알려진 status 값인가. 알 수 없는 값(마이그레이션 중간값 등)은 호출부가 보수적으로 다룬다. */
export function isResponseStatus(status: string): status is ResponseStatus {
  return (responseStatusValues as readonly string[]).includes(status);
}

/** 열린 상태인가(in_progress·drop). 이어하기·되살리기 판정의 공통 술어. */
export function isOpenResponseStatus(status: string): status is OpenResponseStatus {
  return (openResponseStatusValues as readonly string[]).includes(status);
}

/** 종결 상태인가(completed·screened_out·quotaful_out·bad). 알 수 없는 값은 false. */
export function isConcludedResponseStatus(status: string): status is ConcludedResponseStatus {
  return (concludedResponseStatusValues as readonly string[]).includes(status);
}
