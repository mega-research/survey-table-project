import * as z from 'zod';

import type { ContactColumnDef, ContactColumnScheme } from '@/shared/contracts/contacts';

export type { ContactColumnDef, ContactColumnScheme };

/** 복잡 JSONB 스킴은 z.custom 으로 타입만 보장(런타임 통과). */
export const ContactColumnSchemeSchema = z.custom<ContactColumnScheme>();

export const UpdateContactColumnsInput = z.object({
  surveyId: z.string(),
  scheme: ContactColumnSchemeSchema,
});
export type UpdateContactColumnsInput = z.infer<typeof UpdateContactColumnsInput>;

export const GetExistingContactsCountInput = z.object({
  surveyId: z.string(),
});
export type GetExistingContactsCountInput = z.infer<typeof GetExistingContactsCountInput>;

/**
 * 분류 기준 레벨만 패치하는 입력 (진척률 컬럼 설정 등 부분 편집용).
 * 스킴 전체를 클라이언트 스냅샷으로 덮어쓰지 않고, 서버가 최신 스킴을 행 잠금 후
 * groupLevel 필드만 갱신한다 — 동시 편집으로 인한 라벨/순서 손실 방지.
 */
export const UpdateContactGroupLevelsInput = z.object({
  surveyId: z.string(),
  /** attrs 키 → 레벨(1..4). 목록에 없는 attrs 컬럼의 레벨은 해제된다. */
  levels: z.record(z.string(), z.number().int().min(1).max(4)),
});
export type UpdateContactGroupLevelsInput = z.infer<typeof UpdateContactGroupLevelsInput>;
