// 응답 JSONB 계약 — survey_responses.page_visits, response_edit_logs.changed_questions.
// DB 스키마($type<>)·서버·UI 가 공유하는 어휘 — 런타임 의존 없음(리터럴 상수 제외).

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
