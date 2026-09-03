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

/**
 * 지목한 실사 업체가 없거나 이미 종료됐다 (티켓 24).
 *
 * 두 자리가 이 에러를 던진다 — 계정 발급과 **재활성화**(재직 복귀·재입사)다. 후자가 필요한
 * 이유는 실사 계정에 「소속 없음」 상태가 없기 때문이다(0110 의 users_fieldwork_fields_check):
 * 업체가 종료된 뒤 소속 계정을 되살리면 종료된 업체 소속으로 로그인하는 사람이 생긴다.
 * 업체 종료는 재직 중 계정이 0명일 때만 되므로 그 경로로만 도달한다.
 *
 * 워크스페이스 도메인의 `FieldworkOrgNotFoundError` 와 뜻이 겹치지만 여기서 그것을 쓸 수
 * 없다 — 서버 도메인끼리는 서로를 import 하지 않는다(테이블 직접 조회는 허용).
 * procedure 가 CONFLICT 로 바꾼다: 입력은 옳고 지금 상태와 충돌할 뿐이다.
 */
export class InvalidFieldworkOrgError extends Error {
  constructor(message = '소속 업체를 찾을 수 없습니다. 활성 업체를 선택하세요.') {
    super(message);
    this.name = 'InvalidFieldworkOrgError';
  }
}
