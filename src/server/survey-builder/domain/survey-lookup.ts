import * as z from 'zod';

import type { SurveyLookup } from '@/types/survey';

export type { SurveyLookup };

// procedure output 타입은 컴포넌트가 기대하는 types/survey.ts 의 SurveyLookup 으로 통일.
// rows JSONB(Array<Record<string, string|number>>)는 런타임 검증이 과해 z.custom 으로 타입만 보장.
export const SurveyLookupSchema = z.custom<SurveyLookup>();

// 보관함 LUT → 설문 복사. 컴포넌트가 positional (surveyId, savedLookupId) 2인자로 호출하므로
// procedure 에서 객체로 받아 service 에 펼친다.
export const CopySavedLookupInput = z.object({
  surveyId: z.string(),
  savedLookupId: z.string(),
});
export type CopySavedLookupInput = z.infer<typeof CopySavedLookupInput>;

// 설문 LUT upsert. 컴포넌트가 (surveyId, lookup) 2인자로 호출.
export const UpsertSurveyLookupInput = z.object({
  surveyId: z.string(),
  lookup: SurveyLookupSchema,
});
export type UpsertSurveyLookupInput = z.infer<typeof UpsertSurveyLookupInput>;

// 설문 LUT 삭제. (surveyId, surveyLookupId) 2인자.
export const DeleteSurveyLookupInput = z.object({
  surveyId: z.string(),
  surveyLookupId: z.string(),
});
export type DeleteSurveyLookupInput = z.infer<typeof DeleteSurveyLookupInput>;
