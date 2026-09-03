/**
 * 조사표(survey-document) 도메인의 경계를 건너는 모양 — RPC 입출력 zod.
 * 서버 domain 은 이것을 다시 내보내고, UI 훅은 여기서만 받는다.
 */

import * as z from 'zod';

/* ── 조사표 ─────────────────────────────────────────── */

/** 조사표 한 건 — 목록·뷰어가 쓰는 모양. url 은 R2 공개 URL 파생값. */
export const SurveyDocumentSchema = z.object({
  id: z.string(),
  surveyId: z.string(),
  fileKey: z.string(),
  filename: z.string(),
  pageCount: z.number().int().positive(),
  order: z.number().int(),
  url: z.string(),
});
export type SurveyDocument = z.infer<typeof SurveyDocumentSchema>;

export const ListSurveyDocumentsInput = z.object({ surveyId: z.string() });
export type ListSurveyDocumentsInput = z.infer<typeof ListSurveyDocumentsInput>;

/**
 * 업로드 라우트가 돌려준 tmp 키를 설문에 붙인다.
 * pageCount 는 업로드 라우트가 파일에서 읽은 값이라 여기서 다시 재지 않는다 —
 * 대신 상한만 둔다(앵커 page 범위의 근거이므로 터무니없는 값을 막는다).
 */
export const AttachSurveyDocumentInput = z.object({
  surveyId: z.string(),
  key: z.string().min(1),
  filename: z.string().min(1).max(200),
  pageCount: z.number().int().positive().max(2000),
  /** 지정하면 그 조사표를 교체한다(행 갱신 + 이전 파일 유예 삭제 등록). */
  replaceDocumentId: z.string().optional(),
});
export type AttachSurveyDocumentInput = z.infer<typeof AttachSurveyDocumentInput>;

export const RemoveSurveyDocumentInput = z.object({
  surveyId: z.string(),
  documentId: z.string(),
});
export type RemoveSurveyDocumentInput = z.infer<typeof RemoveSurveyDocumentInput>;

/* ── 앵커 ───────────────────────────────────────────── */

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
