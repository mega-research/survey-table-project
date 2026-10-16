/**
 * 운영 콘솔 「테스트 모드로 보기」 쿠키 — 브라우저마다 따로 정하는 콘솔 데이터 파티션.
 *
 * 설문의 `testModeEnabled` 는 테스트 링크·테스트 대상자 링크가 살아 있는지(응답자 쪽)만 정하고,
 * 콘솔이 테스트 파티션을 보고 쓰는지는 이 쿠키가 켜진 브라우저에서만이다. 그래서 한 사람이
 * 테스트 모드를 켜도 다른 사람의 콘솔은 실데이터 그대로다. 판정은 `server/data-scope` 한 곳 —
 * 쿠키는 보기 선택일 뿐이라 전역 플래그가 꺼져 있거나 게스트면 무시된다.
 *
 * 서버(판정)와 클라이언트(켜기·끄기)가 함께 쓰는 순수 모듈 — 'server-only' 금지.
 */

/** 설문마다 쿠키 하나 — 값이 '1' 이면 이 브라우저의 콘솔이 테스트 파티션을 본다. */
export function testViewCookieName(surveyId: string): string {
  return `ops-test-view-${surveyId}`;
}

export const TEST_VIEW_COOKIE_VALUE = '1';

/** 30일 — 켜 둔 채 잊어도 전역 테스트 모드가 꺼지면 무시되고, 콘솔이 보는 즉시 지운다. */
export const TEST_VIEW_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
