import * as z from 'zod';

import type {
  AnalyticsResult,
  SurveyAnalytics,
  SurveySummary,
  TimelineData,
} from '@/lib/analytics/types';

// 컴포넌트/차트가 기대하는 lib/analytics 타입을 도메인에서 재노출.
// (PR2 패턴: 타입 통일 방향은 소비처가 기대하는 도메인 타입)
export type { AnalyticsResult, SurveyAnalytics, SurveySummary, TimelineData };

// ========================
// 입력 스키마 (procedure .input())
// ========================

/** 설문 단위 통계/분석 입력 — surveyId 한 개. */
export const SurveyIdInput = z.object({ surveyId: z.string() });
export type SurveyIdInput = z.infer<typeof SurveyIdInput>;

/** 질문 단위 통계 입력 — surveyId + questionId. */
export const QuestionStatsInput = z.object({
  surveyId: z.string(),
  questionId: z.string(),
});
export type QuestionStatsInput = z.infer<typeof QuestionStatsInput>;

// ========================
// 출력 스키마 (procedure .output())
// ========================

/**
 * calculateResponseSummary 반환 형태.
 * lastResponseAt 은 응답이 0건이면 undefined (data 함수가 lastResponse?.startedAt 로 산출).
 */
export interface ResponseSummary {
  surveyId: string;
  totalResponses: number;
  completedResponses: number;
  averageCompletionTime: number;
  lastResponseAt?: Date;
  responseRate: number;
}
export const ResponseSummarySchema = z.custom<ResponseSummary>();

/**
 * getQuestionStatistics 반환 형태 (discriminated union, but type 필드가 없는 빈 케이스 포함).
 * data 함수 로직 그대로 — type 미존재(응답 0건), 'single' | 'multiple' | 'table' 분기.
 * 복잡/이질적 union 이라 z.custom 으로 타입만 보장.
 */
export type QuestionStatistics =
  | {
      totalResponses: number;
      responseRate: number;
      responses: unknown[];
    }
  | {
      totalResponses: number;
      responseRate: number;
      type: 'single';
      responseCounts: Record<string, number>;
      responses: unknown[];
    }
  | {
      totalResponses: number;
      responseRate: number;
      type: 'multiple';
      optionCounts: Record<string, number>;
      responses: unknown[];
    }
  | {
      totalResponses: number;
      responseRate: number;
      type: 'table';
      responses: unknown[];
    };
export const QuestionStatisticsSchema = z.custom<QuestionStatistics>();

/** analyzeSurvey 반환(SurveyAnalytics) — 복잡 union(AnalyticsResult[]) 포함, z.custom 으로 타입만 보장. */
export const SurveyAnalyticsSchema = z.custom<SurveyAnalytics>();
