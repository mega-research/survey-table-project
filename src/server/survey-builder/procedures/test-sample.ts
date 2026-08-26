import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  GetSurveyTestSampleInput,
  SurveyTestSampleSchema,
} from '../domain/test-sample';
import * as svc from '../services/test-sample';

// 어드민 인증 + 설문 capability 관문 — 기존 requireAuth 의 PII 보호 의도에 팀 경계가 더해졌다.
const get = authed
  .input(GetSurveyTestSampleInput)
  .output(SurveyTestSampleSchema.nullable())
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return svc.getSurveyTestSample(input.surveyId);
  });

export const testSample = {
  get,
};
