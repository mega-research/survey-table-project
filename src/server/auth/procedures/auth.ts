import { ORPCError } from '@orpc/server';

import { account, pub } from '@/server/orpc';

import {
  GetUserOutput,
  InvalidAvatarUrlError,
  ProfileView,
  UpdatePasswordInput,
  UpdatePasswordOutput,
  UpdateProfileInput,
  UpdateProfileOutput,
} from '../domain/auth';
import { UserNotFoundError } from '../domain/users';
import * as svc from '../services/auth';

/**
 * 현재 인증 사용자 조회(pub). 익명도 호출 가능하며, 미인증이면 null.
 * 컨텍스트가 이미 세션을 읽어 두므로 context.user 를 그대로 돌려준다.
 */
const getUser = pub.output(GetUserOutput).handler(({ context }) => context.user);

/**
 * 내 프로필 조회 — 세 계정 유형 공통 (.pen FLOW 3-2).
 *
 * 베이스가 authed 가 아니라 account 인 것이 핵심이다. authed 는 내부 전용이라 게스트·실사가
 * 자기 이름조차 볼 수 없다. 대상은 항상 호출자 자신이라 입력에 userId 가 없다.
 */
const getProfile = account
  .output(ProfileView)
  .handler(({ context }) => svc.getProfile(context.user.id));

/** 내 프로필 수정 — 이름·아바타만. 이메일·직책·소속은 본인이 바꿀 수 없다. */
const updateProfile = account
  .input(UpdateProfileInput)
  .output(UpdateProfileOutput)
  .handler(async ({ input, context }) => {
    try {
      return await svc.updateProfile(context.user.id, input);
    } catch (err) {
      if (err instanceof InvalidAvatarUrlError) {
        throw new ORPCError('BAD_REQUEST', { message: err.message });
      }
      if (err instanceof UserNotFoundError) {
        throw new ORPCError('NOT_FOUND', { message: err.message });
      }
      throw err;
    }
  });

/**
 * 비밀번호 변경 — 세 계정 유형 공통. 검증/재인증은 service 가 Better Auth 에 위임한다.
 * changePassword 는 세션 헤더를 필요로 하므로 context.headers 를 함께 넘긴다.
 */
const updatePassword = account
  .input(UpdatePasswordInput)
  .output(UpdatePasswordOutput)
  .handler(({ input, context }) => svc.updatePassword(context.headers, input));

export const auth = {
  getUser,
  getProfile,
  updateProfile,
  updatePassword,
};
