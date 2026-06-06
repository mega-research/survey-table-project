import { authed } from '@/server/orpc';

import {
  GetSurveyTestSampleInput,
  SurveyTestSampleSchema,
} from '../../domain/test-sample';
import * as svc from '../services/test-sample.service';

// 어드민 인증 필수 — 기존 action 의 requireAuth 로 PII 보호하던 의도 유지.
const get = authed
  .input(GetSurveyTestSampleInput)
  .output(SurveyTestSampleSchema.nullable())
  .handler(({ input }) => svc.getSurveyTestSample(input.surveyId));

export const testSample = {
  get,
};
