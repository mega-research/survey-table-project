import * as z from 'zod';

/** 헤더 필터 드롭다운 — attrs 컬럼 distinct 값 조회 입력. */
export const ListContactAttrValuesInput = z.object({
  surveyId: z.string().uuid(),
  attrsKey: z.string().min(1),
});
export type ListContactAttrValuesInput = z.infer<typeof ListContactAttrValuesInput>;

/** truncated=true 면 체크박스 상한 초과 — 클라이언트는 부분검색 입력으로 폴백. */
export const ListContactAttrValuesOutput = z.object({
  values: z.array(z.string()),
  truncated: z.boolean(),
  /** 이 컬럼이 비어 있는 행 존재 여부 — "(값 없음)" 선택지 노출 판단용. */
  hasEmpty: z.boolean(),
});
export type ListContactAttrValuesOutput = z.infer<typeof ListContactAttrValuesOutput>;
