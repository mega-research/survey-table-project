import * as z from 'zod';

/**
 * 척도 평균 「문항 선택」 저장(setScaleMeanQuestions) 도메인 스키마 — CONTEXT.md 「척도 평균」.
 *
 * questionIds 는 켤 문항 전체다(나머지는 끈다). 후보 밖 id 가 섞이면 { ok:false, error } 로
 * 통째로 거부한다 — 소비처가 result.ok / result.error 로 분기한다(진척률 컬럼 저장과 같은 계약).
 */
export const SetScaleMeanQuestionsInput = z.object({
  surveyId: z.string().uuid(),
  questionIds: z.array(z.string().min(1)).max(1000),
});
export type SetScaleMeanQuestionsInput = z.infer<typeof SetScaleMeanQuestionsInput>;

export const SetScaleMeanQuestionsResult = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type SetScaleMeanQuestionsResult = z.infer<typeof SetScaleMeanQuestionsResult>;
