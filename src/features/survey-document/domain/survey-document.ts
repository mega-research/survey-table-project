import * as z from 'zod';

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
