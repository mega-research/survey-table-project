import * as z from 'zod';

import type { MailTemplate } from '@/db/schema/mail';
import type { MailAttachment } from '@/db/schema/schema-types';
import { mailAttachmentSchema, mailTemplateInputSchema } from '@/lib/mail/schema';

export type { MailTemplate };
export type { MailAttachment };

/**
 * 메일 템플릿 입력 스키마는 lib/mail/schema.ts 에 그대로 두고 도메인이 재노출.
 * (schema 는 render/send 등 lib 내부와 응집되어 있어 lib 에 남긴다.)
 */
export { mailAttachmentSchema, mailTemplateInputSchema };

/** 생성 입력: surveyId + mailTemplateInputSchema 필드 */
export const CreateMailTemplateInput = z.object({
  surveyId: z.string(),
  input: mailTemplateInputSchema,
});
export type CreateMailTemplateInput = z.infer<typeof CreateMailTemplateInput>;

/** 수정 입력: surveyId + templateId + mailTemplateInputSchema 필드 */
export const UpdateMailTemplateInput = z.object({
  surveyId: z.string(),
  templateId: z.string(),
  input: mailTemplateInputSchema,
});
export type UpdateMailTemplateInput = z.infer<typeof UpdateMailTemplateInput>;

/** 삭제(soft delete) 입력 */
export const DeleteMailTemplateInput = z.object({
  surveyId: z.string(),
  templateId: z.string(),
});
export type DeleteMailTemplateInput = z.infer<typeof DeleteMailTemplateInput>;

/**
 * promote 된 영구 key 를 클라이언트로 돌려줘 state 동기화 —
 * 저장 직후 발송에서 stale tmp prefix 로 R2 download 시도하는 사고 차단.
 * attachments 는 복잡 JSONB 라 z.custom 으로 타입만 보장.
 */
export const CreateMailTemplateOutput = z.object({
  id: z.string(),
  attachments: z.custom<MailAttachment[]>(),
});
export type CreateMailTemplateOutput = z.infer<typeof CreateMailTemplateOutput>;

export const UpdateMailTemplateOutput = z.object({
  attachments: z.custom<MailAttachment[]>(),
});
export type UpdateMailTemplateOutput = z.infer<typeof UpdateMailTemplateOutput>;

/** 목록/단건 read 출력 — MailTemplate row 전체(복잡 JSONB 포함) */
export const MailTemplateRowSchema = z.custom<MailTemplate>();
export type MailTemplateRow = z.infer<typeof MailTemplateRowSchema>;
