import type { UserStatus, UserStatusAction, UserType } from '@/shared/contracts/auth';

/**
 * 계정 표시 어휘 — 워크스페이스의 **세 하위 묶음**이 함께 쓴다 (루트 잔류 기준 ①).
 *
 * 사용자 관리(목록·모달)·팀 관리(멤버 행)·실사 업체(계정 행)가 같은 상태 라벨과 배지를
 * 그린다. 묶음 하나 안에 두면 나머지 둘이 그 묶음을 import 하게 되고, 실제로 티켓 24 에서
 * 그 방향이 순환이 됐다(사용자 관리 ↔ 실사 업체). `field-styles.ts` 와 같은 자리다.
 *
 * 값 어휘 자체의 SSOT 는 `shared/contracts/auth` 이고 여기는 그 한글 표시와 색만 갖는다.
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

/**
 * 상태 배지 색 — 라벨과 짝이라 같은 파일에 둔다.
 * 세 화면이 같은 상태를 다른 색으로 그리면 같은 사람이 화면마다 달라 보인다.
 */
export const USER_STATUS_PILL: Record<UserStatus, string> = {
  pending: 'bg-[#FEF3C7] text-[#D97706]',
  active: 'bg-[#DCFCE7] text-[#15803D]',
  rejected: 'bg-[#F5F5F7] text-[#6E6E73]',
  suspended: 'bg-[#FEF3C7] text-[#D97706]',
  departed: 'bg-[#F5F5F7] text-[#6E6E73]',
};

/**
 * 케밥 액션 라벨 — .pen FLOW 1-1 의 「일시 정지·재직 복귀·퇴사·재입사」 어휘.
 * 상태 라벨과 짝이 맞아야 한다 — 「퇴사」 상태의 행이 여는 액션은 「재입사 처리」다.
 */
export const USER_STATUS_ACTION_LABEL: Record<UserStatusAction, string> = {
  suspend: '일시 정지',
  resume: '재직 복귀',
  depart: '퇴사 처리',
  rehire: '재입사 처리',
};
