import * as z from 'zod';

import { type PiiFieldType } from '@/lib/crypto/pii-fields';
import type { ContactMethod } from '@/shared/contracts/contacts';
import { type PiiUpdate, PiiUpdateSchema } from '@/shared/contracts/contacts-io';

export type { ContactMethod };
export type { PiiFieldType };
// PII 변경분 모양은 계약(@/shared/contracts/contacts-io) 소관 — 여기서 다시 내보낸다.
export { PiiUpdateSchema };
export type { PiiUpdate };

export const AddContactTargetInput = z.object({
  surveyId: z.string(),
  attrs: z.record(z.string(), z.string()),
  /** PII 컬럼 값 (재암호화 후 contact_pii 에 저장) */
  piiUpdates: PiiUpdateSchema.array().optional(),
  memo: z.string().nullable().optional(),
  contactMethod: z.custom<ContactMethod>().nullable().optional(),
});
export type AddContactTargetInput = z.infer<typeof AddContactTargetInput>;

export const UpdateContactTargetInput = z.object({
  id: z.string(),
  surveyId: z.string(),
  attrs: z.record(z.string(), z.string()),
  /** PII 컬럼 값 변경분 (재암호화 후 upsert). 변경 없는 컬럼은 보내지 말 것. */
  piiUpdates: PiiUpdateSchema.array().optional(),
  memo: z.string().nullable().optional(),
  contactMethod: z.custom<ContactMethod>().nullable().optional(),
});
export type UpdateContactTargetInput = z.infer<typeof UpdateContactTargetInput>;

export const DeleteContactTargetInput = z.object({
  surveyId: z.string(),
  id: z.string(),
});
export type DeleteContactTargetInput = z.infer<typeof DeleteContactTargetInput>;

export const GenerateTestContactsInput = z.object({
  surveyId: z.string().uuid(),
  count: z.number().int().min(1).max(20),
  recipientEmail: z.string().email(),
});
export type GenerateTestContactsInput = z.infer<typeof GenerateTestContactsInput>;

export const GenerateTestContactsResult = z.object({
  createdCount: z.number().int(),
});

/** add 후 반환 — resid 자동 발번 결과 포함 */
export const ContactTargetRowSchema = z.object({
  id: z.string(),
  resid: z.number(),
});
export type ContactTargetRow = z.infer<typeof ContactTargetRowSchema>;
