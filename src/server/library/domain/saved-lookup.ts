import * as z from 'zod';

import type { SavedLookup } from '@/types/survey';

export type { SavedLookup };

// procedure output 타입은 컴포넌트가 기대하는 types/survey.ts 의 SavedLookup 으로 통일.
// rows JSONB(Array<Record<string, string|number>>)는 런타임 검증이 과해 z.custom 으로 타입만 보장.
export const SavedLookupSchema = z.custom<SavedLookup>();

// LUT 행: 컬럼명 -> 셀 값(문자/숫자) 매핑.
const LookupRowSchema = z.record(z.string(), z.union([z.string(), z.number()]));

// trim 후 빈 문자열은 거부. 공백만 입력해서 통과되는 문제 방지(기존 lookup-actions 와 동일).
const nonBlank = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max));

// 보관함 LUT 생성/수정 공통 필드. 컴포넌트(LookupDraft)가 보내는 형태와 1:1.
// LookupDraft = Pick<SavedLookup, 'name'|'description'|'category'|'tags'|'columns'|'rows'>
const SavedLookupFields = z.object({
  name: nonBlank(200),
  description: z.string().max(1000).optional(),
  category: nonBlank(100),
  tags: z.array(z.string()).default([]),
  columns: z.array(nonBlank(200)).min(1),
  rows: z.array(LookupRowSchema),
});

// list 필터 input. service input = 이 zod infer 타입(exactOptionalPropertyTypes 정합).
export const ListSavedLookupsInput = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
});
export type ListSavedLookupsInput = z.infer<typeof ListSavedLookupsInput>;

// create input = SavedLookupFields 전체. service input = 이 zod infer 타입.
export const CreateSavedLookupInput = SavedLookupFields;
export type CreateSavedLookupInput = z.infer<typeof CreateSavedLookupInput>;

// update input = { id, updates: 부분 필드 }. 기존 updateSavedLookupAction(id, Partial<...>) 형태를
// PR2(saved-questions) 의 { id, updates } 중첩 패턴에 맞춰 통일.
export const UpdateSavedLookupInput = z.object({
  id: z.string(),
  updates: SavedLookupFields.partial(),
});
export type UpdateSavedLookupInput = z.infer<typeof UpdateSavedLookupInput>;
