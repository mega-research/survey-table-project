import * as z from 'zod';

/**
 * 앵커의 대상 종류. DB 에는 저장하지 않는다 — `question_id` 가 채워졌는지로 파생한다.
 * (다형 참조를 기각한 결정: nullable FK 둘 + CHECK 정확히 하나. ADR 0020 배경 참조)
 */
export const AnchorOwnerKind = z.enum(['question', 'group']);
export type AnchorOwnerKind = z.infer<typeof AnchorOwnerKind>;

/** 정규화 사각형 — lib/survey-document/anchor-geometry 의 NormRect 와 같은 모양. */
export const AnchorRectSchema = z.object({
  page: z.number().int().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});
export type AnchorRect = z.infer<typeof AnchorRectSchema>;

export const SurveyAnchorSchema = AnchorRectSchema.extend({
  id: z.string(),
  documentId: z.string(),
  ownerKind: AnchorOwnerKind,
  ownerId: z.string(),
  order: z.number().int(),
});
export type SurveyAnchor = z.infer<typeof SurveyAnchorSchema>;

export const ListSurveyAnchorsInput = z.object({ surveyId: z.string() });
export type ListSurveyAnchorsInput = z.infer<typeof ListSurveyAnchorsInput>;

export const CreateSurveyAnchorInput = z.object({
  surveyId: z.string(),
  documentId: z.string(),
  ownerKind: AnchorOwnerKind,
  ownerId: z.string(),
  rect: AnchorRectSchema,
});
export type CreateSurveyAnchorInput = z.infer<typeof CreateSurveyAnchorInput>;

export const RemoveSurveyAnchorInput = z.object({
  surveyId: z.string(),
  anchorId: z.string(),
});
export type RemoveSurveyAnchorInput = z.infer<typeof RemoveSurveyAnchorInput>;
