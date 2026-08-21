import { z } from 'zod';

/** local-part RFC 5321 단순화: 영문/숫자/점/하이픈/언더스코어 */
const FROM_LOCAL_RE = /^[a-z0-9._-]+$/i;
/** 파일명 안전 문자 (윈도우 reserved 제외) */
const SAFE_FILENAME_RE = /^[^\\/:*?"<>|]{1,200}$/;

export const mailAttachmentSchema = z.object({
  key: z.string().min(1).max(500),
  filename: z.string().regex(SAFE_FILENAME_RE, '파일명에 사용할 수 없는 문자가 있습니다'),
  size: z.number().int().positive().max(15 * 1024 * 1024, '15MB 이하만 가능합니다'),
  mime: z.string().min(1).max(200),
});

export const mailTemplateInputSchema = z.object({
  name: z.string().min(1, '이름을 입력해 주세요').max(100),
  subject: z.string().min(1, '제목을 입력해 주세요').max(255),
  bodyHtml: z.string().default(''),
  fromLocal: z
    .string()
    .min(1, '보낸이 계정을 입력해 주세요')
    .max(64)
    .regex(FROM_LOCAL_RE, '영문/숫자/점/하이픈/언더스코어만'),
  fromName: z.string().min(1, '보낸이 표시명을 입력해 주세요').max(100),
  replyTo: z.string().email('유효한 이메일 주소를 입력해 주세요'),
  attachments: z.array(mailAttachmentSchema).default([]),
});

export type MailTemplateInput = z.infer<typeof mailTemplateInputSchema>;
