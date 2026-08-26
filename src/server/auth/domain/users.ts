// 사용자 관리 도메인 — 경계 계약(shared/contracts/auth-io)의 재노출 + 서버 전용 규칙.
// client-safe — server-only·Node·DB 의존 없음.
export {
  ChangeUserStatusInput,
  ChangeUserStatusOutput,
  CreateUserInput,
  CreateUserOutput,
  ListUsersInput,
  ListUsersOutput,
  ResetUserPasswordInput,
  ResetUserPasswordOutput,
  UserListItem,
} from '@/shared/contracts/auth-io';

/**
 * 이미 쓰이는 이메일로 계정을 만들려 했다.
 *
 * 선검사(SELECT)와 UNIQUE 위반(동시 생성 경합) 두 경로가 같은 결론에 도달하므로 하나로 모은다.
 * procedure 가 CONFLICT 로 바꿔 UI 문구를 만든다 — 사용자 관리는 슈퍼어드민 전용 화면이라
 * 이메일 존재를 알려주는 것이 오라클이 되지 않는다(로그인 화면과 다른 판단).
 */
export class DuplicateEmailError extends Error {
  constructor() {
    super('이미 사용 중인 이메일입니다.');
    this.name = 'DuplicateEmailError';
  }
}

/**
 * 대상 계정이 없다 — 목록에서 사라진 행의 케밥을 눌렀거나 id 를 손으로 넣었다.
 * procedure 가 NOT_FOUND 로 바꾼다.
 */
export class UserNotFoundError extends Error {
  constructor() {
    super('사용자를 찾을 수 없습니다.');
    this.name = 'UserNotFoundError';
  }
}

/**
 * 허용 전이표에 없는 조합이다 (USER_STATUS_TRANSITIONS).
 *
 * 화면은 현재 상태로 열 수 있는 액션만 케밥에 담지만, 목록을 띄워둔 사이에 다른
 * 슈퍼어드민이 상태를 바꿨다면 열려 있던 메뉴가 이미 낡은 것이다 — 서버가 유일한 판정자다.
 */
export class UserStatusTransitionError extends Error {
  constructor(message = '허용되지 않은 계정 상태 전이입니다.') {
    super(message);
    this.name = 'UserStatusTransitionError';
  }
}

/**
 * 이 전이로 active 슈퍼어드민이 0명이 된다.
 *
 * 남은 슈퍼어드민이 없으면 사용자 관리 자체에 들어올 수 있는 사람이 사라져 계정 복구
 * 경로가 DB 직접 조작밖에 남지 않는다.
 */
export class LastActiveSuperadminError extends Error {
  constructor(message = '마지막 슈퍼어드민의 상태는 바꿀 수 없습니다.') {
    super(message);
    this.name = 'LastActiveSuperadminError';
  }
}
