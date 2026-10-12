/**
 * 설문 종료 — 조사가 끝났음을 알리는 상태 전이 (ADR-0030).
 *
 * 전이는 둘뿐이다: `published → closed`(종료), `closed → published`(종료 취소).
 * 종료는 중단(`isPaused`)과 **다른 축**이다 — 중단은 「잠깐 멈춤」이고 종료는 「이제 외부는
 * 전부 끝」이다. 그래서 두 값은 서로를 건드리지 않는다.
 *
 * `draft` 는 이 전이의 바깥이다. 종료할 것이 없고(받은 응답이 없다), 종료 취소로 발행 상태가
 * 되어서도 안 된다 — 발행은 스냅샷을 만드는 일이라 status 만 published 인 초안은 응답 화면이
 * 열 스냅샷이 없는 채로 「배포됨」이 된다.
 */

/** 종료·종료 취소가 허용되는 설문 status — 「발행된 적 있는 설문」. */
export const CLOSABLE_SURVEY_STATUSES = ['published', 'closed'] as const;

/** 발행된 적 없는 설문에 종료·종료 취소를 요청했다. */
export class SurveyNotClosableError extends Error {
  constructor() {
    super('발행된 적 없는 설문은 종료할 수 없습니다.');
    this.name = 'SurveyNotClosableError';
  }
}
