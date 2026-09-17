import { ORPCError } from '@orpc/server';

import { superadmin } from '@/server/orpc';
import { departUserWithSuccession, DepartureSuccessionError } from '@/server/workflows/user-departure';
import { RehireTeamAssignmentError, rehireUserWithTeam } from '@/server/workflows/user-rehire';

import {
  ChangeUserStatusInput,
  ChangeUserStatusOutput,
  CreateUserInput,
  CreateUserOutput,
  DuplicateEmailError,
  InvalidFieldworkOrgError,
  LastActiveSuperadminError,
  ListUsersInput,
  ListUsersOutput,
  ResetUserPasswordInput,
  ResetUserPasswordOutput,
  UpdateUserInput,
  UpdateUserOutput,
  UserNotFoundError,
  UserStatusTransitionError,
  UserTypeMismatchError,
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
    err instanceof UserTypeMismatchError ||
    err instanceof UserStatusTransitionError ||
    // 소속 업체가 없거나 종료됐다 — 발급과 재활성화가 함께 쓴다(티켓 24).
    err instanceof InvalidFieldworkOrgError ||
    err instanceof LastActiveSuperadminError ||
    // 재입사의 팀 배정 실패 — 전체가 롤백돼 계정은 퇴사 상태 그대로다. 사유 문구는 워크스페이스
    // 도메인이 쓴 것을 워크플로가 감싸 보존한다(경계를 넘지 않으려고 감싼다).
    err instanceof RehireTeamAssignmentError ||
    // 퇴사의 승계 실패 — 같은 구조다. 롤백돼 계정은 재직 상태 그대로다(티켓 19).
    err instanceof DepartureSuccessionError
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
 * 유형별 필드 차이는 CreateUserInput 유니온이 판정한다 — 실사는 소속 업체 id·역할이
 * 필수라 빠뜨린 호출은 여기 도달하기 전에 BAD_REQUEST 로 떨어진다. 그 id 가 **활성 업체**
 * 인지는 서비스가 트랜잭션 안에서 잠근 채 확인한다(티켓 24).
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
 *
 * **재입사와 퇴사는 다른 입구로 간다.** 둘 다 상태 전이(auth)와 워크스페이스 쓰기를 한
 * 트랜잭션으로 묶어야 해서 워크플로 층이 처리한다 — 도메인 서비스끼리는 서로를 부를 수
 * 없다. 재입사는 팀 배정을, 퇴사는 소유권 승계를 함께 쓴다(티켓 14·19).
 * 여기서 갈라 두는 편이 auth 서비스가 워크플로를 아는 것보다 낫다(의존 방향이 한쪽이다).
 */
const changeStatus = superadmin
  .input(ChangeUserStatusInput)
  .output(ChangeUserStatusOutput)
  .handler(async ({ input, context }) => {
    try {
      if (input.action === 'rehire') return await rehireUserWithTeam(context.user, input);
      if (input.action === 'depart') return await departUserWithSuccession(context.user, input);
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

/** 사용자 정보 편집 — 이름·이메일·유형별 소속 칸 (슈퍼어드민 전용). 유형·상태는 바꾸지 않는다. */
const update = superadmin
  .input(UpdateUserInput)
  .output(UpdateUserOutput)
  .handler(async ({ input }) => {
    try {
      return await svc.updateUser(input);
    } catch (err) {
      throw toRpcError(err) ?? err;
    }
  });

export const users = {
  list,
  create,
  update,
  changeStatus,
  resetPassword,
};
