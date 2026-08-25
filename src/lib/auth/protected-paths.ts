/**
 * 비로그인 접근을 허용하는 인증 관련 경로.
 *
 * proxy(1차 게이트)와 admin 레이아웃(재검증)이 같은 목록을 봐야 하므로 여기 한 곳에 둔다.
 * v2 는 공개 가입·이메일 비밀번호 재설정이 없어(ADR-0018) 로그인 화면 하나뿐이다.
 */
export const AUTH_PAGES: ReadonlySet<string> = new Set(['/admin/login']);
