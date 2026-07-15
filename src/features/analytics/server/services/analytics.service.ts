import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { notDeletedResponse, notTestResponse } from '@/data/response-filters';
import { getResponsesWithAnswers } from '@/data/responses';
import { getSurveyWithDetails } from '@/data/surveys';
import { analyzeSurvey } from '@/lib/analytics/analyzer';
import { decryptQuestionResponses } from '@/lib/crypto/response-pii';

import type {
  QuestionStatistics,
  ResponseSummary,
  SurveyAnalytics,
} from '../../domain/analytics';

// ========================
// 내부 조회 헬퍼 (data/responses.ts 로직 인라인 — service 자기완결)
// ========================

/** 설문별 응답 조회 (삭제·테스트 제외, 시작시간 내림차순) — 통계 모수 */
async function listResponses(surveyId: string) {
  return db.query.surveyResponses.findMany({
    where: and(eq(surveyResponses.surveyId, surveyId), notDeletedResponse, notTestResponse),
    orderBy: [desc(surveyResponses.startedAt)],
  });
}

/** 완료된 응답만 조회 (삭제·테스트 제외, 완료시간 내림차순) — 통계 모수 */
async function listCompletedResponses(surveyId: string) {
  return db.query.surveyResponses.findMany({
    where: and(
      eq(surveyResponses.surveyId, surveyId),
      eq(surveyResponses.isCompleted, true),
      notDeletedResponse,
      notTestResponse,
    ),
    orderBy: [desc(surveyResponses.completedAt)],
  });
}

// ========================
// 통계
// ========================

/**
 * 응답 통계 요약.
 * lastResponseAt 은 응답이 0건이면 undefined (exactOptionalPropertyTypes 대응으로 조건 set).
 */
export async function getResponseSummary(surveyId: string): Promise<ResponseSummary> {
  const allResponses = await listResponses(surveyId);
  const completedResponses = allResponses.filter((r) => r.isCompleted);

  const totalResponses = allResponses.length;
  const completedCount = completedResponses.length;

  // 평균 완료 시간 계산 (분 단위)
  const completionTimes = completedResponses
    .filter((r) => r.completedAt)
    .map((r) => {
      const startTime = new Date(r.startedAt).getTime();
      const completedTime = new Date(r.completedAt!).getTime();
      return (completedTime - startTime) / (1000 * 60);
    });

  const averageCompletionTime =
    completionTimes.length > 0
      ? completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length
      : 0;

  const lastResponse = allResponses[0];

  const result: ResponseSummary = {
    surveyId,
    totalResponses,
    completedResponses: completedCount,
    averageCompletionTime,
    responseRate: totalResponses > 0 ? (completedCount / totalResponses) * 100 : 0,
  };
  if (lastResponse?.startedAt != null) {
    result.lastResponseAt = lastResponse.startedAt;
  }
  return result;
}

/**
 * 질문별 통계.
 * 응답값의 형태(배열/객체/스칼라)에 따라 multiple/table/single 분기.
 * 응답이 0건이면 type 없는 빈 형태 반환.
 */
export async function getQuestionStatistics(
  surveyId: string,
  questionId: string,
): Promise<QuestionStatistics> {
  const rawCompletedResponses = await listCompletedResponses(surveyId);
  const completedResponses = rawCompletedResponses.map((r) => ({
    ...r,
    questionResponses: decryptQuestionResponses(
      (r.questionResponses ?? {}) as Record<string, unknown>,
      { responseId: r.id },
    ),
  }));

  const questionResponses = completedResponses
    .map((r) => (r.questionResponses as Record<string, unknown>)[questionId])
    .filter((r) => r !== undefined && r !== null && r !== '');

  if (questionResponses.length === 0) {
    return {
      totalResponses: 0,
      responseRate: 0,
      responses: [],
    };
  }

  const firstResponse = questionResponses[0];

  if (Array.isArray(firstResponse)) {
    // 다중 선택 또는 체크박스
    const allOptions = questionResponses.flat() as string[];
    const optionCounts: Record<string, number> = {};

    allOptions.forEach((option) => {
      if (typeof option === 'string') {
        optionCounts[option] = (optionCounts[option] || 0) + 1;
      }
    });

    return {
      totalResponses: questionResponses.length,
      responseRate: (questionResponses.length / completedResponses.length) * 100,
      type: 'multiple',
      optionCounts,
      responses: questionResponses,
    };
  } else if (typeof firstResponse === 'object' && firstResponse !== null) {
    // 테이블 응답
    return {
      totalResponses: questionResponses.length,
      responseRate: (questionResponses.length / completedResponses.length) * 100,
      type: 'table',
      responses: questionResponses,
    };
  } else {
    // 단일 응답 (텍스트, 라디오)
    const responseCounts: Record<string, number> = {};

    questionResponses.forEach((response) => {
      const key = String(response);
      responseCounts[key] = (responseCounts[key] || 0) + 1;
    });

    return {
      totalResponses: questionResponses.length,
      responseRate: (questionResponses.length / completedResponses.length) * 100,
      type: 'single',
      responseCounts,
      responses: questionResponses,
    };
  }
}

// ========================
// 분석
// ========================

/**
 * 전체 설문 분석 (서버 계산).
 * 설문 구조(질문 포함) + 완료 응답(response_answers 조인 변환)을 fetch 한 뒤
 * 순수 함수 analyzeSurvey 로 집계한다.
 * 설문이 없으면 throw.
 *
 * 주의: 대시보드의 인터랙티브 필터링(applyFilter)은 클라이언트 메모리 계산으로 유지(범위 밖).
 * 이 procedure 는 필터 없는 전체 분석 스냅샷을 제공한다.
 */
export async function analyzeSurveyById(surveyId: string): Promise<SurveyAnalytics> {
  const survey = await getSurveyWithDetails(surveyId);
  if (!survey) throw new Error('설문을 찾을 수 없습니다.');

  // analyzeSurvey 는 완료 응답을 내부에서 isCompleted 필터하지만,
  // 분모 일관성을 위해 response_answers 조인 변환된 완료 응답을 전달한다.
  // getResponsesWithAnswers 는 이미 복호화되어 반환되지만, 접두사 감지로 재적용해도
  // 무해하므로 이 경계에서도 명시적으로 감싼다(호출 경로 변경에 대한 방어).
  const rawResponses = await getResponsesWithAnswers(surveyId);
  const responses = rawResponses.map((r) => ({
    ...r,
    questionResponses: decryptQuestionResponses(
      (r.questionResponses ?? {}) as Record<string, unknown>,
      { responseId: r.id },
    ),
  }));

  return analyzeSurvey(
    { id: survey.id, title: survey.title, questions: survey.questions },
    responses,
  );
}
