import * as z from 'zod';

import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';

import {
  CreateMailTemplateInput,
  CreateMailTemplateOutput,
  DeleteMailTemplateInput,
  UpdateMailTemplateInput,
  UpdateMailTemplateOutput,
} from '../../domain/mail-template';
import * as svc from '../services/mail-templates.service';

/**
 * service throw 를 사용자 친화 ORPCError 로 변환.
 * - AttachmentPromoteError: 첨부 promote 부분 실패 → 재시도 안내 메시지(원본 의미론 보존).
 * - MailTemplateNotFoundError: 다른 설문/없는 템플릿 → NOT_FOUND.
 */
function mapServiceError(err: unknown): never {
  if (err instanceof svc.AttachmentPromoteError) {
    throw new ORPCError('BAD_REQUEST', {
      message: `첨부 파일을 저장하지 못했습니다 (${err.failedKeys.length}개). 잠시 후 다시 시도해 주세요.`,
    });
  }
  if (err instanceof svc.MailTemplateNotFoundError) {
    throw new ORPCError('NOT_FOUND', { message: '템플릿을 찾을 수 없습니다' });
  }
  throw err;
}

const create = authed
  .input(CreateMailTemplateInput)
  .output(CreateMailTemplateOutput)
  .handler(async ({ input }) => {
    try {
      return await svc.createMailTemplate(input);
    } catch (err) {
      mapServiceError(err);
    }
  });

const update = authed
  .input(UpdateMailTemplateInput)
  .output(UpdateMailTemplateOutput)
  .handler(async ({ input }) => {
    try {
      return await svc.updateMailTemplate(input);
    } catch (err) {
      mapServiceError(err);
    }
  });

const remove = authed
  .input(DeleteMailTemplateInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    try {
      await svc.deleteMailTemplate(input);
      return { ok: true as const };
    } catch (err) {
      mapServiceError(err);
    }
  });

export const templates = {
  create,
  update,
  remove,
};
