import * as z from 'zod';

import { type PiiFieldType } from '@/lib/crypto/pii-fields';
import type { ContactMethod } from '@/shared/contracts/contacts';
import { type PiiUpdate, PiiUpdateSchema } from '@/shared/contracts/contacts-io';

export type { ContactMethod };
export type { PiiFieldType };
// PII 변경분 모양은 계약(@/shared/contracts/contacts-io) 소관 — 여기서 다시 내보낸다.
export { PiiUpdateSchema };
export type { PiiUpdate };

/** 시스템 필드(분류 기준)가 attrs 의 어느 키에 있는지 — 컬럼 스킴의 systemFields 맵 활용 */
export const SystemFieldKeysSchema = z.object({
  group: z.string().optional(),
});

export const AddContactTargetInput = z.object({
  surveyId: z.string(),
  attrs: z.record(z.string(), z.string()),
  /** PII 컬럼 값 (재암호화 후 contact_pii 에 저장) */
  piiUpdates: PiiUpdateSchema.array().optional(),
  memo: z.string().nullable().optional(),
  contactMethod: z.custom<ContactMethod>().nullable().optional(),
  systemFieldKeys: SystemFieldKeysSchema.optional(),
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
  systemFieldKeys: SystemFieldKeysSchema.optional(),
});
export type UpdateContactTargetInput = z.infer<typeof UpdateContactTargetInput>;

/**
 * 메모·연락 방법만 쓰는 좁은 입력 (티켓 26).
 *
 * `UpdateContactTargetInput` 과 갈라 두는 이유는 **capability 가 다르기 때문**이다. 저쪽은
 * `attrs`·PII 를 함께 받아 명단 수정(`contacts.manage`)이고, 이쪽은 실사의 회차 쓰기
 * (`contacts.writeAttempts`)와 같은 자격으로 연다. 필드를 옵셔널로 합치면 한 표면이 두
 * 자격을 지게 되고, 그 순간 실사에게 명단 수정이 함께 열린다(티켓 25 가 남긴 이유).
 */
export const SetContactTargetMemoInput = z.object({
  surveyId: z.string(),
  id: z.string(),
  memo: z.string().max(2000).nullable(),
  contactMethod: z.custom<ContactMethod>().nullable(),
});
export type SetContactTargetMemoInput = z.infer<typeof SetContactTargetMemoInput>;

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
