import { ORPCError } from '@orpc/server';

import { superadmin } from '@/server/orpc';

import {
  ChangeUserStatusInput,
  ChangeUserStatusOutput,
  CreateUserInput,
  CreateUserOutput,
  DuplicateEmailError,
  LastActiveSuperadminError,
  ListUsersInput,
  ListUsersOutput,
  ResetUserPasswordInput,
  ResetUserPasswordOutput,
  UserNotFoundError,
  UserStatusTransitionError,
} from '../domain/users';
import * as svc from '../services/users';

/**
 * 사용자 관리 도메인 에러 → RPC 코드. 이 파일의 매핑 규약은 여기 하나다.
 *
 * 이메일 중복·전이 거부·마지막 슈퍼어드민 가드는 모두 CONFLICT 다 — 입력은 문법적으로 옳고
 * 지금 상태와 충돌할 뿐이라, 화면은 문구를 그대로 띄우고 목록을 다시 읽으면 된다.
 * 매핑되지 않은 예외는 null 을 돌려 호출측이 그대로 올린다(500 으로 남는다).
 */
function toRpcError(err: unknown): ORPCError<string, unknown> | null {
  if (err instanceof UserNotFoundError) return new ORPCError('NOT_FOUND', { message: err.message });
  if (
    err instanceof DuplicateEmailError ||
    err instanceof UserStatusTransitionError ||
    err instanceof LastActiveSuperadminError
  ) {
    return new ORPCError('CONFLICT', { message: err.message });
  }
  return null;
}

/** 사용자 목록 — 유형·상태 필터 + 유형 칩 카운트 (슈퍼어드민 전용). */
const list = superadmin
  .input(ListUsersInput)
  .output(ListUsersOutput)
  .handler(({ input }) => svc.listUsers(input));

/**
 * 계정 직접 발급 (슈퍼어드민 전용).
 *
 * 유형별 필드 차이는 CreateUserInput 유니온이 판정한다 — 실사 유형은 유니온에 없어
 * 여기 도달하기 전에 BAD_REQUEST 로 떨어진다(티켓 24 에서 열린다).
 */
const create = superadmin
  .input(CreateUserInput)
  .output(CreateUserOutput)
  .handler(async ({ input, context }) => {
    try {
      return await svc.createUser(context.user.id, input);
    } catch (err) {
      throw toRpcError(err) ?? err;
    }
  });

/**
 * 계정 상태 전이 — 일시 정지 / 재직 복귀 / 퇴사 / 재입사 (슈퍼어드민 전용).
 *
 * 어떤 전이가 가능한지는 서버가 유일한 판정자다. 화면 케밥은 같은 전이표를 보고 메뉴를
 * 구성하지만, 목록을 띄워둔 사이 상태가 바뀌었으면 열려 있던 메뉴가 이미 낡은 것이다.
 */
const changeStatus = superadmin
  .input(ChangeUserStatusInput)
  .output(ChangeUserStatusOutput)
  .handler(async ({ input, context }) => {
    try {
      return await svc.changeUserStatus(context.user.id, input);
    } catch (err) {
      throw toRpcError(err) ?? err;
    }
  });

/** 비밀번호 재설정 — 새 임시 비밀번호 + 대상 세션 전부 폐기 (슈퍼어드민 전용). */
const resetPassword = superadmin
  .input(ResetUserPasswordInput)
  .output(ResetUserPasswordOutput)
  .handler(async ({ input, context }) => {
    try {
      return await svc.resetUserPassword(context.user.id, input);
    } catch (err) {
      throw toRpcError(err) ?? err;
    }
  });

export const users = {
  list,
  create,
  changeStatus,
  resetPassword,
};
