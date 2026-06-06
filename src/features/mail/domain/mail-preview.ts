import * as z from 'zod';

import { mailAttachmentSchema } from '@/lib/mail/schema';

/**
 * 메일 템플릿 미리보기용 — 해당 설문의 첫 컨택 1건 샘플.
 * inviteUrl 은 서버에서 NEXT_PUBLIC_APP_URL 기준으로 빌드된 값.
 */
export const MailPreviewSampleSchema = z.object({
  attrs: z.record(z.string(), z.string()),
  inviteUrl: z.string(),
  email: z.string().nullable(),
  resid: z.number(),
});
export type MailPreviewSample = z.infer<typeof MailPreviewSampleSchema>;

/** 미리보기 샘플 입력 */
export const GetMailPreviewSampleInput = z.object({
  surveyId: z.string(),
});
export type GetMailPreviewSampleInput = z.infer<typeof GetMailPreviewSampleInput>;

/**
 * 미리보기 샘플 출력 — 컨택 0건이면 null.
 * 원본 ActionResult{ok:true,data} 를 풀어 데이터 또는 null 로 단순화.
 */
export const GetMailPreviewSampleOutput = MailPreviewSampleSchema.nullable();
export type GetMailPreviewSampleOutput = z.infer<typeof GetMailPreviewSampleOutput>;

/** 테스트 발송 입력 — 원본 InputSchema 와 동일 검증. */
export const SendTestTemplateMailInput = z.object({
  surveyId: z.string().uuid(),
  to: z.string().email('수신자 이메일 형식이 올바르지 않습니다.'),
  subject: z.string().min(1, '제목이 비어있습니다.').max(200),
  bodyHtml: z.string(),
  fromName: z.string().min(1, '발신자 이름이 비어있습니다.'),
  fromLocal: z.string().min(1, '발신자 이메일 local 이 비어있습니다.'),
  replyTo: z.string().email('Reply-To 이메일 형식이 올바르지 않습니다.'),
  attachments: z.array(mailAttachmentSchema).default([]),
});
export type SendTestTemplateMailInput = z.infer<typeof SendTestTemplateMailInput>;

/**
 * 테스트 발송 결과 — env 가드/발송 실패는 throw 하지 않고 결과객체로 흘려
 * UI 에 사용자 친화 메시지를 그대로 보존(원본 의미론 유지).
 */
export const SendTestTemplateMailOutput = z.object({
  ok: z.boolean(),
  id: z.string().optional(),
  error: z.string().optional(),
});
export type SendTestTemplateMailOutput = z.infer<typeof SendTestTemplateMailOutput>;
