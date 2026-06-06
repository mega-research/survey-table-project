import * as z from 'zod';

import type { SurveyVersion } from '@/db/schema';

export type { SurveyVersion };

/**
 * 설문 배포(publishSurvey) 도메인 스키마.
 *
 * 다인자(surveyId, changeNote?) -> 단일 input object 로 묶음(oRPC procedure 단일 input).
 * 출력은 db schema SurveyVersion($inferSelect) 전체 행(publish 가 newVersion 반환).
 */
export const PublishSurveyInput = z.object({
  surveyId: z.string(),
  changeNote: z.string().optional(),
});
export type PublishSurveyInput = z.infer<typeof PublishSurveyInput>;

export const SurveyVersionRowSchema = z.custom<SurveyVersion>();
