import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  QuestionStatisticsSchema,
  QuestionStatsInput,
  ResponseSummarySchema,
  SurveyAnalyticsSchema,
  SurveyIdInput,
} from '../domain/analytics';
import * as svc from '../services/analytics';

// 분석 procedure 는 전부 analytics.view 관문을 지난다 (역할 모델 v2 티켓 09, 스펙 §8).

// ========================
// stats — 응답 통계
// ========================

const statsSurvey = authed
  .input(SurveyIdInput)
  .output(ResponseSummarySchema)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'analytics.view');
    return svc.getResponseSummary(input.surveyId);
  });

const statsQuestion = authed
  .input(QuestionStatsInput)
  .output(QuestionStatisticsSchema)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'analytics.view');
    return svc.getQuestionStatistics(input.surveyId, input.questionId);
  });

// ========================
// analyze — 전체 설문 분석
// ========================

const analyzeSurvey = authed
  .input(SurveyIdInput)
  .output(SurveyAnalyticsSchema)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'analytics.view');
    return svc.analyzeSurveyById(input.surveyId);
  });

export const analytics = {
  stats: {
    survey: statsSurvey,
    question: statsQuestion,
  },
  analyze: {
    survey: analyzeSurvey,
  },
};
