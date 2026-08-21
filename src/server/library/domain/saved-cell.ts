import * as z from 'zod';

import type { NewSavedCell, SavedCellRow } from '@/db/schema/surveys';
import type { SavedCell, TableCell } from '@/types/survey';

export type { NewSavedCell, SavedCellRow };
export type { SavedCell };

/** 복잡 JSONB(TableCell)는 z.custom으로 타입만 보장(런타임 통과). */
export const TableCellSchema = z.custom<TableCell>();
// 보관함 저장 시 sanitize되어 위치/이미지 필드가 빠진 부분 셀이 반환되므로 Partial로 표현.
export const PartialTableCellSchema = z.custom<Partial<TableCell>>();
// procedure output 타입은 컴포넌트가 기대하는 types/survey.ts 의 SavedCell으로 통일.
export const SavedCellSchema = z.custom<SavedCell>();

// useSaveCell().mutate({ cell, name })로 호출하므로 동일 형태로 정의.
// cell은 sanitizeCellForLibrary 전의 원본 TableCell을 받음.
export const CreateSavedCellInput = z.object({
  cell: TableCellSchema,
  name: z.string().min(1),
});
export type CreateSavedCellInput = z.infer<typeof CreateSavedCellInput>;
