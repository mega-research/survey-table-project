/**
 * 주소 구역의 어휘 — 1차 게이트(proxy)와 레이아웃 가드가 **같은 목록**을 본다.
 *
 * `/admin` 접두를 걷은 뒤(라우트 그룹 `app/(internal)/`) 내부 콘솔이 루트 여덟 개로 흩어졌다.
 * 접두 하나로 「이 아래는 전부 세션이 필요하다」를 말할 수 없게 됐으므로, 그 목록이 여기 서고
 * **완전성은 테스트가 파일 시스템에서 확인한다**(`tests/repo/proxy-matcher-coverage.test.ts`).
 * 목록의 출처를 사람에 두면 새 루트가 조용히 게이트 밖에서 자란다 — 이 레포가
 * `rsc-page-guards`·라우터 열거에서 쓰는 관용구를 그대로 쓴다.
 */

/**
 * 세션 쿠키를 요구하는 **루트 세그먼트** 전수.
 *
 * `app/(internal)/*` 의 디렉터리 이름 + 이미 루트인 내부 구역(`analytics`) + 계정 유형 구역
 * (`guest`·`fieldwork`)이다. `fw` 는 **없다** — 외주 실사 링크는 계정 세션이 아니라 링크
 * 세션으로 열리므로 여기 넣으면 외주가 전원 로그인으로 튕긴다(ADR-0026).
 *
 * proxy 의 matcher 는 Next 가 정적으로 읽어야 해서 이 배열을 그대로 쓸 수 없고 리터럴을
 * 따로 적는다 — 둘이 어긋나지 않는 것은 위 가드가 본다.
 */
export const SESSION_GATED_ROOT_SEGMENTS: readonly string[] = [
  // app/(internal)/* — 직원 콘솔
  'billing',
  'file-cleanup',
  'login',
  'profile',
  'reassignment',
  'surveys',
  'teams',
  'users',
  // 이미 루트였던 내부 구역
  'analytics',
  // 계정 유형 구역 — 유형 일치 판정은 페이지의 requireAccountTypePage 몫이고,
  // 1차 게이트는 「쿠키가 있는가」만 본다(경로마다 다를 이유가 없다).
  'guest',
  'fieldwork',
];

/**
 * 세션 없이 열려야 하는 **루트 세그먼트** — 응답자·외주·클라이언트 표면.
 *
 * 위 목록과 겹치면 안 되고, matcher 에 들어가면 응답자가 로그인으로 튕긴다. 출처는
 * `tests/repo/rsc-page-guards.test.ts` 의 `PUBLIC_PAGES` 이며 그 대조도 가드가 한다.
 * `api` 는 Route Handler 라 각자 가드를 지고, `/`(랜딩)는 세그먼트가 없어 목록 밖이다.
 */
export const PUBLIC_ROOT_SEGMENTS: readonly string[] = [
  'survey',
  'i',
  'preview',
  'unsubscribe',
  'fw',
  // 클라이언트 링크 (ADR-0029) — 계정이 아니라 링크 세션으로 열린다. `/fw` 와 같은 이유로
  // matcher 밖이어야 한다(넣으면 클라이언트가 전원 로그인으로 튕긴다).
  'client',
];

/**
 * 비로그인 접근을 허용하는 인증 관련 경로.
 *
 * proxy(1차 게이트)와 내부 레이아웃(재검증)이 같은 목록을 봐야 하므로 여기 한 곳에 둔다.
 * v2 는 공개 가입·이메일 비밀번호 재설정이 없어(ADR-0018) 로그인 화면 하나뿐이다.
 */
export const AUTH_PAGES: ReadonlySet<string> = new Set(['/login']);

/**
 * 계정 유형과 무관하게 열리는 내부 경로 — 자기 계정 화면.
 *
 * 내부 콘솔 트리에 있지만 내부 전용이 아니다. 세 유형 모두 이름·아바타·비밀번호를 여기서
 * 바꾸며(.pen FLOW 3-2), 게스트·실사는 각자 홈의 사용자 메뉴로 진입한다. 내부 레이아웃의
 * 유형 게이트와 로그인 목적지 해석이 같은 목록을 봐야 하므로 여기 한 곳에 둔다.
 */
export const ACCOUNT_PAGES: ReadonlySet<string> = new Set(['/profile']);

/** 로그인 화면의 주소 — 리다이렉트를 만드는 자리가 여럿이라 문자열을 흩뿌리지 않는다. */
export const LOGIN_PATH = '/login';
