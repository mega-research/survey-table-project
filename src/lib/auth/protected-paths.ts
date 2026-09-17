/**
 * 비로그인 접근을 허용하는 인증 관련 경로.
 *
 * proxy(1차 게이트)와 admin 레이아웃(재검증)이 같은 목록을 봐야 하므로 여기 한 곳에 둔다.
 * v2 는 공개 가입·이메일 비밀번호 재설정이 없어(ADR-0018) 로그인 화면 하나뿐이다.
 */
export const AUTH_PAGES: ReadonlySet<string> = new Set(['/admin/login']);

/**
 * 계정 유형과 무관하게 열리는 admin 경로 — 자기 계정 화면.
 *
 * `/admin` 아래 있지만 내부 전용이 아니다. 세 유형 모두 이름·아바타·비밀번호를 여기서
 * 바꾸며(.pen FLOW 3-2), 게스트·실사는 각자 홈의 사용자 메뉴로 진입한다. admin 레이아웃의
 * 유형 게이트와 로그인 목적지 해석이 같은 목록을 봐야 하므로 여기 한 곳에 둔다.
 */
export const ACCOUNT_PAGES: ReadonlySet<string> = new Set(['/admin/profile']);
