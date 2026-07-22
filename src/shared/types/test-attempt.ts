/**
 * 대상자 테스트 화면이 mutation과 telemetry 전체에서 공유하는 소유권 식별자.
 * client와 feature domain, server 구현이 함께 쓰는 전송 계약이다.
 */
export interface TestAttemptIdentity {
  attemptId?: string | undefined;
  sessionId?: string | undefined;
}
