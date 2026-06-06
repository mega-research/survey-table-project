import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';

import { SaveAdminEditInput, SaveAdminEditOutput } from '../../domain/response-edit';
import * as svc from '../services/response-edit.service';

/**
 * service throw 를 사용자 친화 ORPCError 로 변환.
 * - SurveyOwnershipError('not_found') / 'Response not found' → NOT_FOUND.
 * - 'Cannot edit deleted response' → BAD_REQUEST.
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
  throw err;
}

const saveAdminEdit = authed
  .input(SaveAdminEditInput)
  .output(SaveAdminEditOutput)
  .handler(async ({ input }) => {
    try {
      return await svc.saveAdminEdit(input);
    } catch (err) {
      mapServiceError(err);
    }
  });

export const edit = {
  saveAdminEdit,
};
