/**
 * 예상하지 못한 내부 실패 — INSERT 가 행을 돌려주지 않음·불변식 위반·환경변수 누락처럼
 * "일어나면 안 되는" 경우에 던진다. RPC 에서는 문구가 클라이언트에 가려지고
 * ('Internal server error') Sentry 로 간다(rpc-error-policy 의 isSentryWorthyRpcError).
 *
 * 사용자가 이해하고 고칠 수 있는 거부(검증 실패·없음·충돌·상태가 바뀜)는 이것이 아니라
 * 코드 있는 `ORPCError` 로 던진다 — 그래야 문구가 화면까지 가고 Sentry 에 장애로 쌓이지 않는다.
 * `src/server` 에서 `throw new Error(...)` 는 ESLint 가 막는다: 둘 중 어느 쪽인지 고르게 하려는 것이다.
 */
export class InternalFailure extends Error {
  override readonly name = 'InternalFailure';
}
