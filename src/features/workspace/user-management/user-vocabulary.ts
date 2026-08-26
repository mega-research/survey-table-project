import type { UserStatus, UserType } from '@/shared/contracts/auth';

/**
 * 사용자 관리 화면의 표시 어휘 — 목록과 생성 모달이 함께 쓴다.
 *
 * 유형 라벨이 화면마다 따로 있으면 유형이 늘 때(실사 활성화, 티켓 24) 한쪽만 고쳐진다.
 * 값 어휘 자체의 SSOT 는 `shared/contracts/auth` 이고 여기는 그 한글 표시만 갖는다.
 */
export const USER_TYPE_LABEL: Record<UserType, string> = {
  internal: '내부',
  guest: '게스트',
  fieldwork: '실사',
};

/**
 * 상태 표시. pending/rejected 는 도달 불가 어휘지만(ADR-0018) 과거 데이터가 실려 있어도
 * 빈 배지로 보이지 않게 라벨을 함께 둔다 — 필터 선택지에는 없다.
 */
export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  pending: '승인 대기',
  active: '재직 중',
  rejected: '승인 거절',
  suspended: '일시 정지',
  departed: '퇴사',
};
