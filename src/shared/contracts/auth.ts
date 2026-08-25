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
// 전이(앱 코드 기준, 티켓 04 에서 구현):
//   active ⇄ suspended, active/suspended → departed, departed → active(재입사)

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
// users.user_type — 계정 유형 어휘 (SSOT)
// ─────────────────────────────────────────────────────────────────────────────
//
// internal  사내 계정. 팀 멤버십·admin 내부 표면은 이 유형만.
// guest     클라이언트 발급 계정 — 부여된 설문의 프리뷰 + 현황 탭 화이트리스트만.
// fieldwork 실사 업체 소속 계정 — 초대된 설문의 조사 대상·대리 응답만.

/** users.user_type 전체 값. */
export const userTypeValues = ['internal', 'guest', 'fieldwork'] as const;
export type UserType = (typeof userTypeValues)[number];
