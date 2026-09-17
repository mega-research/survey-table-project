// 잔존 Server Actions — oRPC 마이그레이션에서 의도적으로 유지한 것만 남는다.
// - unsubscribe form actions: 메일 클라이언트 JS 비활성 환경의 POST form + redirect 경로
//   (unsubscribe-actions.ts 직접 import).
// 로그인/로그아웃은 Better Auth 로 이관됐다 — 로그인은 authClient.signIn.email + 로그인
// 페이지(RSC)의 목적지 해석, 로그아웃은 authClient.signOut(LogoutButton) 과 게스트 강제
// Better Auth 클라이언트(authClient.signOut)가 맡는다.
// 나머지 도메인은 전부 src/server/*/procedures (oRPC) 로 이관 완료.
