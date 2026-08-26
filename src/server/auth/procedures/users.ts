import { ORPCError } from '@orpc/server';

import { superadmin } from '@/server/orpc';

import {
  CreateUserInput,
  CreateUserOutput,
  DuplicateEmailError,
  ListUsersInput,
  ListUsersOutput,
} from '../domain/users';
import * as svc from '../services/users';

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
      if (err instanceof DuplicateEmailError) {
        throw new ORPCError('CONFLICT', { message: err.message });
      }
      throw err;
    }
  });

export const users = {
  list,
  create,
};
