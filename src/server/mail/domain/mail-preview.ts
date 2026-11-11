import * as z from 'zod';

import { type MailPreviewSample, MailPreviewSampleSchema } from '@/shared/contracts/mail-io';

import { mailAttachmentSchema } from './schema';

// 미리보기 샘플 모양은 계약(@/shared/contracts/mail-io) 소관 — 여기서 다시 내보낸다.
export { MailPreviewSampleSchema };
export type { MailPreviewSample };

/** 미리보기 샘플 입력. contactTargetId 지정 시 첫 컨택 대신 해당 컨택 기준 샘플. */
export const GetMailPreviewSampleInput = z.object({
  surveyId: z.string(),
  contactTargetId: z.string().uuid().optional(),
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
  /**
   * 보낸 메일의 초대 링크 종류(성공 시) — live = 눌러서 열리는 테스트 대상자 링크,
   * sandbox = 열리지 않는 견본 링크(테스트 모드 꺼짐·게스트·조사 대상 없음).
   */
  inviteLink: z.enum(['live', 'sandbox']).optional(),
});
export type SendTestTemplateMailOutput = z.infer<typeof SendTestTemplateMailOutput>;
