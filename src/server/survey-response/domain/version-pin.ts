/**
 * 응답이 묶일 버전 — 테스트 응답은 지금 테스트 버전(CONTEXT.md 「테스트 버전」, 아직 없으면 배포본),
 * 실응답은 현재 배포본. 응답 생성 · 테스트 대상자 회차 · 재개 이관이 같은 규칙을 쓴다.
 */
export interface VersionPins {
  currentVersionId: string | null;
  testVersionId: string | null;
}

export function pinnedVersionId(pins: VersionPins, isTest: boolean): string | null {
  return isTest ? (pins.testVersionId ?? pins.currentVersionId) : pins.currentVersionId;
}
