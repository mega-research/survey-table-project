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
// 복호화한 응답값을 그대로 싣는 표면(문항 통계의 responses·응답별 키, 전체 분석의 textResponses)은
// responses.view 도 함께 묻는다 — 분석 RSC 화면 둘이 이미 그 짝을 요구하므로, RPC 가
// analytics.view 만 보면 팀원 열(responses.view 없음)이 직접 호출로 원문을 읽는다.

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
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'responses.view');
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
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'responses.view');
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
