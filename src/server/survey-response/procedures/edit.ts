import { ORPCError } from '@orpc/server';

import { isGuestUser } from '@/lib/auth/guest-grants';
import { assertSurveyAccess, scoped } from '@/server/orpc';

import { SaveAdminEditInput, SaveAdminEditOutput } from '../domain/response-edit';
import * as svc from '../services/response-edit.service';

/**
 * service throw 를 사용자 친화 ORPCError 로 변환.
 * - SurveyOwnershipError('not_found') / 'Response not found' → NOT_FOUND.
 * - 'Cannot edit deleted response' → BAD_REQUEST.
 * - 'Version conflict' → CONFLICT.
 */
function mapServiceError(err: unknown): never {
  if (err instanceof svc.SurveyOwnershipError) {
    throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다' });
  }
  if (err instanceof Error && err.message === 'Response not found') {
    throw new ORPCError('NOT_FOUND', { message: '응답을 찾을 수 없습니다' });
  }
  if (err instanceof Error && err.message === 'Cannot edit deleted response') {
    throw new ORPCError('BAD_REQUEST', { message: '삭제된 응답은 수정할 수 없습니다' });
  }
  if (err instanceof Error && err.message === 'Version conflict') {
    throw new ORPCError('CONFLICT', {
      message: '수정 중 새 버전이 배포되었습니다. 새로고침 후 다시 수정해 주세요.',
    });
  }
  throw err;
}

const saveAdminEdit = scoped
  .input(SaveAdminEditInput)
  .output(SaveAdminEditOutput)
  .handler(async ({ input, context }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    try {
      return await svc.saveAdminEdit(
        input,
        {
          id: context.user?.id ?? null,
          email: context.user?.email ?? null,
        },
        // 인증된 context 에서 1회 파생 — 서비스가 auth 를 재조회하지 않는다.
        isGuestUser(context.user.id),
      );
    } catch (err) {
      mapServiceError(err);
    }
  });

export const edit = {
  saveAdminEdit,
};
