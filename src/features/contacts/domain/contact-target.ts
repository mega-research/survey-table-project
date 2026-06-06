import * as z from 'zod';

import type { ContactMethod } from '@/db/schema/schema-types';
import type { PiiFieldType } from '@/lib/crypto/pii-fields';

export type { ContactMethod };
export type { PiiFieldType };

/**
 * PII 컬럼 1건 변경분. service 가 contact_pii 에 재암호화 upsert.
 * plain 이 빈 문자열이면 기존 PII row 삭제.
 */
export const PiiUpdateSchema = z.object({
  /** ContactColumnDef.source 가 'pii.<columnKey>' 인 컬럼의 columnKey */
  columnKey: z.string(),
  fieldType: z.custom<PiiFieldType>(),
  /** 평문값. 빈 문자열이면 기존 PII row 삭제. */
  plain: z.string(),
});
export type PiiUpdate = z.infer<typeof PiiUpdateSchema>;

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

export const DeleteContactTargetInput = z.object({
  surveyId: z.string(),
  id: z.string(),
});
export type DeleteContactTargetInput = z.infer<typeof DeleteContactTargetInput>;

/** add 후 반환 — resid 자동 발번 결과 포함 */
export const ContactTargetRowSchema = z.object({
  id: z.string(),
  resid: z.number(),
});
export type ContactTargetRow = z.infer<typeof ContactTargetRowSchema>;
