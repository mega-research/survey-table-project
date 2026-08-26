// 계정 계약 — users.status·users.user_type 어휘 (SSOT).
// DB 스키마($type<>)·서버·UI 가 공유하는 어휘 — 런타임 의존 없음(리터럴 상수·순수 술어 제외).

// ─────────────────────────────────────────────────────────────────────────────
// users.status — 계정 상태 어휘 (SSOT)
// ─────────────────────────────────────────────────────────────────────────────
//
// text 컬럼이라 DB 제약은 없다. 값 집합은 이 모듈이 유일한 출처다.
//
// v2(ADR-0018)에서 공개 가입·승인 플로우가 폐기되어 pending/rejected 는 **도달 불가
// 어휘**다 — 앱 어디에도 이 값을 쓰는 경로가 없고, 슈퍼어드민 직접 발급 계정은 생성
// 즉시 active 다. surveys.status='closed' 와 같은 취급으로, 공개 가입을 재개할 때
// 복귀시키기 위해 어휘만 보존한다. 단 로그인 차단 판정(status !== 'active')에는
// 값이 실려 있으면 그대로 걸린다 — 안전한 기본값이다.
//
// 허용 전이는 아래 USER_STATUS_TRANSITIONS 가 정본이다.

/** users.status 전체 값. pending/rejected 는 도달 불가 어휘 (위 주석 참조). */
export const userStatusValues = [
  'pending',
  'active',
  'rejected',
  'suspended',
  'departed',
] as const;
export type UserStatus = (typeof userStatusValues)[number];

// ─────────────────────────────────────────────────────────────────────────────
// 상태 전이 — 슈퍼어드민이 사용자 행 케밥에서 일으키는 작업 (SSOT)
// ─────────────────────────────────────────────────────────────────────────────

/** 상태 전이 작업 어휘. 값 자체가 RPC 입력의 판별자다. */
export const userStatusActionValues = ['suspend', 'resume', 'depart', 'rehire'] as const;
export type UserStatusAction = (typeof userStatusActionValues)[number];

/**
 * 허용 전이표 — 서버 강제와 화면 케밥이 함께 보는 유일한 출처.
 *
 * `as const satisfies Record<...>` 로 쓰면 안 된다. action 유니온으로 인덱싱할 때 키별
 * 리터럴 튜플의 유니온이 되어 `.from.includes(current)` 의 인자 타입이 never 로 좁혀진다
 * (워크트리 Plan2 Task 5 에서 실제로 tsc 가 막았다). 명시적 Record 주석으로 조회 결과
 * 타입을 균일화하면서, 신규 action 이 누락되면 컴파일 에러로 호명되는 성질은 유지한다.
 *
 * departed → active 가 resume 이 아니라 rehire 인 것이 핵심이다 — 퇴사는 세션·팀·소유권을
 * 정리하므로 일반 재직 복귀로 되살릴 수 없다(ADR-0010).
 */
export const USER_STATUS_TRANSITIONS: Record<
  UserStatusAction,
  { from: readonly UserStatus[]; to: UserStatus }
> = {
  suspend: { from: ['active'], to: 'suspended' },
  resume: { from: ['suspended'], to: 'active' },
  depart: { from: ['active', 'suspended'], to: 'departed' },
  rehire: { from: ['departed'], to: 'active' },
};

/**
 * 이 상태의 행에서 열 수 있는 전이 작업 — 케밥 메뉴 구성에 UI 가 쓴다.
 * 서버 강제(resolveUserStatusTransition)와 같은 표를 보므로 화면과 판정이 갈리지 않는다.
 */
export function availableUserStatusActions(status: UserStatus): UserStatusAction[] {
  return userStatusActionValues.filter((action) =>
    USER_STATUS_TRANSITIONS[action].from.includes(status),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// users.user_type — 계정 유형 어휘 (SSOT)
// ─────────────────────────────────────────────────────────────────────────────
//
// internal  사내 계정. 팀 멤버십·admin 내부 표면은 이 유형만.
// guest     클라이언트 발급 계정 — 부여된 설문의 프리뷰 + 현황 탭 화이트리스트만.
// fieldwork 실사 업체 소속 계정 — 초대된 설문의 조사 대상·대리 응답만.

/** users.user_type 전체 값. */
export const userTypeValues = ['internal', 'guest', 'fieldwork'] as const;
export type UserType = (typeof userTypeValues)[number];

// ─────────────────────────────────────────────────────────────────────────────
// 인증 사용자 — 서버와 UI 가 합의한 세션 사용자 모양
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 세션에서 읽어낸 현재 사용자. oRPC 컨텍스트(server/context)·REST 가드(lib/auth)·
 * auth.getUser 출력이 모두 이 모양을 쓴다.
 */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string;
  status: UserStatus;
  isSuperadmin: boolean;
  /** 계정 유형. 내부 표면 접근 판정에 쓴다 — guest/fieldwork 는 자기 콘솔만 본다. */
  userType: UserType;
}

/**
 * 표면 접근을 허용할 계정 상태인가 — 인증 게이트의 단일 술어.
 * 세션 발급 자체는 lib/auth/server.ts 훅이 막지만, 발급 뒤 상태가 바뀐 세션도 있으므로
 * 요청 시점에 다시 본다(oRPC authed/scoped · requireAuth · 보호 경로 레이아웃 공용).
 */
export function isActiveUser(status: UserStatus | undefined): boolean {
  return status === 'active';
}

/**
 * 내부(사내) 계정인가 — admin 표면 접근의 단일 술어.
 *
 * guest·fieldwork 계정은 발급되는 순간 로그인은 되지만(계정 수명주기는 세 유형 공통)
 * 내부 표면은 전부 서버에서 막힌다. 각자의 콘솔(티켓 22·25)은 이 술어를 지나지 않는
 * 자기 가드(oRPC scoped 등)로 열린다.
 */
export function isInternalUser(userType: UserType | undefined): boolean {
  return userType === 'internal';
}

// ─────────────────────────────────────────────────────────────────────────────
// accounts.provider_id / accounts.issuer — 크리덴셜 계정 규약값 (SSOT)
// ─────────────────────────────────────────────────────────────────────────────
//
// better-auth 1.7 이 이메일+비밀번호 계정에 쓰는 값. 시드·직접 발급 경로가 어댑터와
// 같은 행 모양을 만들 때 이 상수를 쓴다 — 어긋나면 sign-in 의 계정 조회
// (providerId + issuer + accountId=user.id 매칭)가 조용히 실패한다.

/** 이메일+비밀번호 계정의 accounts.provider_id 값. */
export const CREDENTIAL_PROVIDER_ID = 'credential';

/** 이메일+비밀번호 계정의 accounts.issuer 값 — better-auth createLocalAccountIssuer 산출. */
export const LOCAL_CREDENTIAL_ISSUER = 'local:credential';
