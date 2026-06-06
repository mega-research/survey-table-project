import { authed, pub } from '@/server/orpc';

import { GetUserOutput, UpdatePasswordInput, UpdatePasswordOutput } from '../../domain/auth';
import * as svc from '../services/auth.service';

/**
 * 현재 인증 사용자 조회(pub). 익명도 호출 가능하며, 미인증이면 null.
 * 미들웨어 redirect 체크/클라 인증 상태 쿼리에서 사용하므로 공개로 둔다.
 */
const getUser = pub
  .output(GetUserOutput)
  .handler(({ context }) => svc.getUser(context.supabase));

/**
 * 비밀번호 변경(authed). authed 통과로 context.user 가 non-null.
 * 검증/재인증 로직은 service 에 위임.
 */
const updatePassword = authed
  .input(UpdatePasswordInput)
  .output(UpdatePasswordOutput)
  .handler(({ input, context }) =>
    svc.updatePassword(context.supabase, context.user, input),
  );

export const auth = {
  getUser,
  updatePassword,
};
