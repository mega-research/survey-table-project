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

/**
 * 회신 주소 — **선택 입력** (티켓 20).
 *
 * 비어 있으면 발송 시점의 설문 소유자 이메일로 해석된다(server/mail/services/reply-to).
 * 그래서 「미설정」이 표현 가능해야 하고, 그 값은 반드시 **null** 이어야 한다 — 빈 문자열이
 * 컬럼에 들어가면 `?? 소유자` 폴백이 서지 않아 회신 헤더가 빈 채로 나간다.
 *
 * 형식 검사는 남는다. 비우는 것과 잘못 적는 것은 다르고, 오타를 통과시키면 답장이 존재하지
 * 않는 주소로 사라진다.
 */
export const optionalReplyToSchema = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .refine(
    (value) => value === null || z.email().safeParse(value).success,
    '유효한 이메일 주소를 입력해 주세요',
  )
  .nullish()
  .transform((value) => value ?? null);

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
  replyTo: optionalReplyToSchema,
  attachments: z.array(mailAttachmentSchema).default([]),
});

export type MailTemplateInput = z.infer<typeof mailTemplateInputSchema>;
