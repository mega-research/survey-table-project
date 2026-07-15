import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { responseAnswers, surveyResponses, surveyVersions } from '@/db/schema';
import { answersToQuestionResponses } from '@/lib/analytics/response-adapter';
import { decryptQuestionResponses } from '@/lib/crypto/response-pii';
import { notDeletedResponse, notTestResponse } from '@/data/response-filters';

import type { ResponsesWithAnswersInput } from '../../domain/survey-read';

// 이 service 는 actions/query-actions 의 requireAuth 를 제거한다(authed 미들웨어가 대체).
// data/responses.ts 의 조회·export 로직을 byte 보존으로 흡수한다. notDeletedResponse 필터는
// data/response-filters 에서 제자리 import. drizzle: ANY/timestamptz lock 미사용(eq/and/isNull).

// ========================
// 응답 조회 (authed)
// ========================

// 설문별 응답 조회 (테스트 응답 제외 — 통계·목록 공용 모수. 테스트 응답 표시가 필요한
// 화면은 operations profiles 경로가 담당한다.)
export async function getResponsesBySurvey(surveyId: string) {
  const responses = await db.query.surveyResponses.findMany({
    where: and(eq(surveyResponses.surveyId, surveyId), notDeletedResponse, notTestResponse),
    orderBy: [desc(surveyResponses.startedAt)],
  });
  // authed procedure 로 그대로 노출되는 경계 — PII 암호문을 평문으로 복호화해 반환
  return responses.map((r) => ({
    ...r,
    questionResponses: decryptQuestionResponses(
      (r.questionResponses ?? {}) as Record<string, unknown>,
      { responseId: r.id },
    ),
  }));
}

// 완료된 응답만 조회 (테스트 응답 제외 — export 모수)
export async function getCompletedResponses(surveyId: string) {
  const responses = await db.query.surveyResponses.findMany({
    where: and(
      eq(surveyResponses.surveyId, surveyId),
      eq(surveyResponses.isCompleted, true),
      notDeletedResponse,
      notTestResponse,
    ),
    orderBy: [desc(surveyResponses.completedAt)],
  });
  // authed procedure 로 그대로 노출되는 경계 — PII 암호문을 평문으로 복호화해 반환
  return responses.map((r) => ({
    ...r,
    questionResponses: decryptQuestionResponses(
      (r.questionResponses ?? {}) as Record<string, unknown>,
      { responseId: r.id },
    ),
  }));
}

// 응답 단일 조회(소프트삭제 제외). WS-2 IDOR 봉인: responseId 단독 조회는 다른 설문
// 소속 응답까지 끄집어낼 수 있으므로 surveyId 를 WHERE 스코프에 추가해 봉인한다.
// (data/responses 의 includeDeleted 경로는 다른 호출자 전용 — 본 service 미노출.)
// notTestResponse 의도적 미적용: 단건 조회는 모수 통계가 아니고, 관리자가 테스트 응답
// 상세를 열람할 수 있어야 한다 (data/responses.ts getResponseById 와 동일 예외).
export async function getResponseById(responseId: string, surveyId: string) {
  const where = and(
    eq(surveyResponses.id, responseId),
    eq(surveyResponses.surveyId, surveyId),
    notDeletedResponse,
  );
  const response = await db.query.surveyResponses.findFirst({ where });
  if (!response) return response;
  return {
    ...response,
    questionResponses: decryptQuestionResponses(
      (response.questionResponses ?? {}) as Record<string, unknown>,
      { responseId: response.id },
    ),
  };
}

// 버전별 완료된 응답 조회 (response_answers JOIN + 어댑터 변환)
export async function getResponsesWithAnswers(input: ResponsesWithAnswersInput) {
  const { surveyId, versionId } = input;

  // 버전 필터 조건 구성 (테스트 응답 제외 — analytics 모수)
  const conditions = [
    eq(surveyResponses.surveyId, surveyId),
    eq(surveyResponses.isCompleted, true),
    notDeletedResponse,
    notTestResponse,
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
    const merged =
      answers && answers.length > 0
        ? { ...r, questionResponses: answersToQuestionResponses(answers) }
        : r;
    return {
      ...merged,
      questionResponses: decryptQuestionResponses(
        (merged.questionResponses ?? {}) as Record<string, unknown>,
        { responseId: r.id },
      ),
    };
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
// 내보내기 (authed)
// ========================

// 응답 데이터 내보내기 (JSON)
export async function exportResponsesAsJson(surveyId: string) {
  const responses = await getCompletedResponses(surveyId);
  const decrypted = responses.map((r) => ({
    ...r,
    questionResponses: decryptQuestionResponses(
      (r.questionResponses ?? {}) as Record<string, unknown>,
      { responseId: r.id },
    ),
  }));
  return JSON.stringify(decrypted, null, 2);
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

    const responseData = decryptQuestionResponses(
      response.questionResponses as Record<string, unknown>,
      { responseId: response.id },
    );
    Array.from(questionIds).forEach((questionId) => {
      const value = responseData[questionId];
      if (value === null || value === undefined) {
        // typeof null === 'object' 함정: null 을 object 분기에 보내면 "null" 문자열이 셀에 들어간다.
        row.push('');
      } else if (Array.isArray(value)) {
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
