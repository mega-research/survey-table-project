import { authed } from '@/server/orpc';

import {
  QuestionStatisticsSchema,
  QuestionStatsInput,
  ResponseSummarySchema,
  SurveyAnalyticsSchema,
  SurveyIdInput,
} from '../../domain/analytics';
import * as svc from '../services/analytics.service';

// ========================
// stats — 응답 통계
// ========================

const statsSurvey = authed
  .input(SurveyIdInput)
  .output(ResponseSummarySchema)
  .handler(({ input }) => svc.getResponseSummary(input.surveyId));

const statsQuestion = authed
  .input(QuestionStatsInput)
  .output(QuestionStatisticsSchema)
  .handler(({ input }) => svc.getQuestionStatistics(input.surveyId, input.questionId));

// ========================
// analyze — 전체 설문 분석
// ========================

const analyzeSurvey = authed
  .input(SurveyIdInput)
  .output(SurveyAnalyticsSchema)
  .handler(({ input }) => svc.analyzeSurveyById(input.surveyId));

export const analytics = {
  stats: {
    survey: statsSurvey,
    question: statsQuestion,
  },
  analyze: {
    survey: analyzeSurvey,
  },
};
