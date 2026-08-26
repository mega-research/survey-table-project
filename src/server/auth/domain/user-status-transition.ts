// 계정 상태 전이 강제 — 허용 전이표(shared/contracts/auth)를 서버 규칙으로 닫는다.
// client-safe — server-only·Node·DB 의존 없음.
import {
  USER_STATUS_TRANSITIONS,
  type UserStatus,
  type UserStatusAction,
  reducesActiveSuperadminCount,
} from '@/shared/contracts/auth';

import { LastActiveSuperadminError, UserStatusTransitionError } from './users';

/**
 * 다음 상태를 정한다. 허용되지 않으면 던진다.
 *
 * `isLastActiveSuperadmin` 은 호출측이 계산해 넘긴다 — "이 전이로 active 슈퍼어드민이
 * 0명이 되는가"라는 뜻이다. 대상이 지금 active 가 아니면(이미 정지된 슈퍼어드민의 퇴사)
 * 이 전이는 active 인원을 줄이지 않으므로 호출측은 false 를 넘겨야 한다. 워크트리
 * Plan2 Task 5 리뷰에서 이 의미를 좁히지 않아 suspended 슈퍼어드민의 퇴사가 오차단됐다.
 *
 * 전이 가능 여부를 가드보다 먼저 본다 — 애초에 불가능한 조합에 "마지막 슈퍼어드민이라
 * 안 된다"고 답하면 원인을 잘못 짚게 된다.
 */
export function resolveUserStatusTransition(
  current: UserStatus,
  action: UserStatusAction,
  isLastActiveSuperadmin: boolean,
): UserStatus {
  const transition = USER_STATUS_TRANSITIONS[action];
  if (!transition.from.includes(current)) {
    throw new UserStatusTransitionError();
  }
  if (isLastActiveSuperadmin && reducesActiveSuperadminCount(action)) {
    throw new LastActiveSuperadminError(
      action === 'suspend'
        ? '마지막 슈퍼어드민은 일시 정지할 수 없습니다.'
        : '마지막 슈퍼어드민은 퇴사 처리할 수 없습니다.',
    );
  }
  return transition.to;
}

/**
 * 감사 행(user_status_events.reason)에 남길 문구.
 *
 * 이 표면의 전이는 전부 슈퍼어드민이 사용자 관리에서 일으킨다 — 행위자는 changed_by 가
 * 갖고 있으므로 reason 은 "무엇을 눌렀는가"를 남긴다. 발급의 '슈퍼어드민 직접 발급'과
 * 같은 계보다.
 */
export const USER_STATUS_ACTION_REASON: Record<UserStatusAction, string> = {
  suspend: '슈퍼어드민 일시 정지',
  resume: '슈퍼어드민 재직 복귀',
  depart: '슈퍼어드민 퇴사 처리',
  rehire: '슈퍼어드민 재입사 처리',
};

/** 비밀번호 재설정 감사 행의 reason. 상태는 바뀌지 않으므로 from=to 로 남는다. */
export const PASSWORD_RESET_REASON = '슈퍼어드민 비밀번호 재설정';
