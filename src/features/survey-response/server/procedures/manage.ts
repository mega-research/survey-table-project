import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';

import {
  HardResetResponseInput,
  ResponseManageOutput,
  RestoreResponseInput,
  SoftDeleteResponseInput,
} from '../../domain/response-manage';
import * as svc from '../services/response-manage.service';

/** SurveyOwnershipError('not_found') → NOT_FOUND. */
function mapServiceError(err: unknown): never {
  if (err instanceof svc.SurveyOwnershipError) {
    throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다' });
  }
  throw err;
}

const softDelete = authed
  .input(SoftDeleteResponseInput)
  .output(ResponseManageOutput)
  .handler(async ({ input }) => {
    try {
      return await svc.softDeleteResponse(input);
    } catch (err) {
      mapServiceError(err);
    }
  });

const restore = authed
  .input(RestoreResponseInput)
  .output(ResponseManageOutput)
  .handler(async ({ input }) => {
    try {
      return await svc.restoreResponse(input);
    } catch (err) {
      mapServiceError(err);
    }
  });

const hardReset = authed
  .input(HardResetResponseInput)
  .output(ResponseManageOutput)
  .handler(async ({ input }) => {
    try {
      return await svc.hardResetResponse(input);
    } catch (err) {
      mapServiceError(err);
    }
  });

export const manage = {
  softDelete,
  restore,
  hardReset,
};
