import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';

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

// 전체 설문의 응답 수를 한 번의 GROUP BY 로 집계 (설문별 fan-out N+1 제거).
// 설문 목록 대시보드처럼 여러 설문의 총/완료 응답 수가 동시에 필요할 때 사용.
// 반환: surveyId -> { total, completed } Map. 응답이 0건인 설문은 키 없음.
export async function getResponseCountsGroupedBySurvey() {
  const rows = await db
    .select({
      surveyId: surveyResponses.surveyId,
      total: count(),
      completed: sql<number>`count(*) filter (where ${surveyResponses.isCompleted} = true)`,
    })
    .from(surveyResponses)
    .where(notDeletedResponse)
    .groupBy(surveyResponses.surveyId);

  const map = new Map<string, { total: number; completed: number }>();
  for (const r of rows) {
    map.set(r.surveyId, { total: Number(r.total), completed: Number(r.completed) });
  }
  return map;
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
