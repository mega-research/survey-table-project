import * as z from 'zod';

// 빌더의 "테스트 중" 상태에서 본문의 {{변수}} 토큰을 첫 컨택의 attrs 로 치환하기 위한 샘플.
// 기존 action 의 ActionResult({ ok, error?, data? }) 래퍼는 oRPC 에러 채널로 대체하고,
// procedure output 은 SurveyTestSample | null 을 직접 반환한다.
export const SurveyTestSampleSchema = z.object({
  attrs: z.record(z.string(), z.string()),
  resid: z.number(),
});
export type SurveyTestSample = z.infer<typeof SurveyTestSampleSchema>;

export const GetSurveyTestSampleInput = z.object({ surveyId: z.string() });
export type GetSurveyTestSampleInput = z.infer<typeof GetSurveyTestSampleInput>;
