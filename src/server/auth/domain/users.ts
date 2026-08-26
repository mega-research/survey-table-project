// 사용자 관리 도메인 — 경계 계약(shared/contracts/auth-io)의 재노출 + 서버 전용 규칙.
// client-safe — server-only·Node·DB 의존 없음.
export {
  CreateUserInput,
  CreateUserOutput,
  ListUsersInput,
  ListUsersOutput,
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
