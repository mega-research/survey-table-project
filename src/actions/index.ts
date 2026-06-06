// 잔존 Server Actions — oRPC 마이그레이션에서 의도적으로 유지한 것만 남는다.
// - auth login/logout: redirect + revalidatePath('/','layout') + 쿠키 세션 의미론이 server action 특화.
// - unsubscribe form actions: 메일 클라이언트 JS 비활성 환경의 POST form + redirect 경로 (unsubscribe-actions.ts 직접 import).
// 나머지 도메인은 전부 src/features/*/server/procedures (oRPC) 로 이관 완료.

// Auth Actions
export { login, logout } from './auth-actions';
