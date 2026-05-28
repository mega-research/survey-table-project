import { and, count, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { responseAnswers, surveyResponses, surveyVersions } from '@/db/schema';
import { answersToQuestionResponses } from '@/lib/analytics/response-adapter';
import { notDeletedResponse } from '@/data/response-filters';

// ========================
// 응답 조회 함수
// ========================

// 설문별 응답 조회
export async function getResponsesBySurvey(surveyId: string) {
  const responses = await db.query.surveyResponses.findMany({
    where: and(eq(surveyResponses.surveyId, surveyId), notDeletedResponse),
    orderBy: [desc(surveyResponses.startedAt)],
  });
  return responses;
}

// 완료된 응답만 조회
export async function getCompletedResponses(surveyId: string) {
  const responses = await db.query.surveyResponses.findMany({
    where: and(
      eq(surveyResponses.surveyId, surveyId),
      eq(surveyResponses.isCompleted, true),
      notDeletedResponse,
    ),
    orderBy: [desc(surveyResponses.completedAt)],
  });
  return responses;
}

// 응답 단일 조회
export async function getResponseById(
  responseId: string,
  options: { includeDeleted?: boolean } = {},
) {
  const where = options.includeDeleted
    ? eq(surveyResponses.id, responseId)
    : and(eq(surveyResponses.id, responseId), notDeletedResponse);
  const response = await db.query.surveyResponses.findFirst({ where });
  return response;
}

// 설문별 응답 수 조회
export async function getResponseCountBySurvey(surveyId: string) {
  const result = await db
    .select({ count: count() })
    .from(surveyResponses)
    .where(and(eq(surveyResponses.surveyId, surveyId), notDeletedResponse));

  return result[0]?.count || 0;
}

// 설문별 완료된 응답 수 조회
export async function getCompletedResponseCountBySurvey(surveyId: string) {
  const result = await db
    .select({ count: count() })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.isCompleted, true),
        notDeletedResponse,
      ),
    );

  return result[0]?.count || 0;
}

// 버전별 완료된 응답 조회 (response_answers JOIN + 어댑터 변환)
export async function getResponsesWithAnswers(
  surveyId: string,
  versionId?: string | null,
) {
  // 버전 필터 조건 구성
  const conditions = [
    eq(surveyResponses.surveyId, surveyId),
    eq(surveyResponses.isCompleted, true),
    notDeletedResponse,
  ];

  if (versionId) {
    conditions.push(eq(surveyResponses.versionId, versionId));
  }

  const responses = await db.query.surveyResponses.findMany({
    where: and(...conditions),
    with: {
      answers: true,
    },
    orderBy: [desc(surveyResponses.completedAt)],
  });

  // response_answers가 있으면 어댑터로 변환, 없으면 기존 JSONB 사용
  return responses.map((r) => {
    const answers = (r as typeof r & { answers?: typeof responseAnswers.$inferSelect[] }).answers;
    if (answers && answers.length > 0) {
      return {
        ...r,
        questionResponses: answersToQuestionResponses(answers),
      };
    }
    return r;
  });
}

// 설문의 버전 목록 조회
export async function getSurveyVersions(surveyId: string) {
  const versions = await db.query.surveyVersions.findMany({
    where: and(
      eq(surveyVersions.surveyId, surveyId),
      isNull(surveyVersions.deletedAt),
    ),
    orderBy: [desc(surveyVersions.versionNumber)],
    columns: {
      id: true,
      versionNumber: true,
      status: true,
      changeNote: true,
      publishedAt: true,
    },
  });
  return versions;
}

// ========================
// 통계 조회 함수
// ========================

// 응답 통계 계산
export async function calculateResponseSummary(surveyId: string) {
  const allResponses = await getResponsesBySurvey(surveyId);
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

  return {
    surveyId,
    totalResponses,
    completedResponses: completedCount,
    averageCompletionTime,
    lastResponseAt: lastResponse?.startedAt,
    responseRate: totalResponses > 0 ? (completedCount / totalResponses) * 100 : 0,
  };
}

// 질문별 통계 계산
export async function getQuestionStatistics(surveyId: string, questionId: string) {
  const completedResponses = await getCompletedResponses(surveyId);

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
// 내보내기 함수
// ========================

// 응답 데이터 내보내기 (JSON)
export async function exportResponsesAsJson(surveyId: string) {
  const responses = await getCompletedResponses(surveyId);
  return JSON.stringify(responses, null, 2);
}

// 응답 데이터 내보내기 (CSV)
export async function exportResponsesAsCsv(surveyId: string) {
  const responses = await getCompletedResponses(surveyId);

  if (responses.length === 0) return '';

  const headers = ['응답 ID', '시작 시간', '완료 시간', '완료 시간(분)'];
  const questionIds = new Set<string>();

  responses.forEach((response) => {
    Object.keys(response.questionResponses as Record<string, unknown>).forEach((questionId) => {
      questionIds.add(questionId);
    });
  });

  headers.push(...Array.from(questionIds));

  const csvData = responses.map((response) => {
    const completionTime = response.completedAt
      ? (new Date(response.completedAt).getTime() - new Date(response.startedAt).getTime()) /
        (1000 * 60)
      : 0;

    const row = [
      response.id,
      response.startedAt.toISOString(),
      response.completedAt?.toISOString() || '',
      completionTime.toFixed(2),
    ];

    const responseData = response.questionResponses as Record<string, unknown>;
    Array.from(questionIds).forEach((questionId) => {
      const value = responseData[questionId];
      if (Array.isArray(value)) {
        row.push(value.join('; '));
      } else if (typeof value === 'object') {
        row.push(JSON.stringify(value));
      } else {
        row.push(String(value || ''));
      }
    });

    return row;
  });

  return [headers, ...csvData]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
