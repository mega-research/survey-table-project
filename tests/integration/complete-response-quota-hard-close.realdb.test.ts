/**
 * 쿼터 「진행 중 마감」 제출 시점 하드 차단 — 실DB 경합 테스트 (ADR 0025).
 *
 * mock DB 는 직렬화를 검증하지 못한다(9/21 고유 값 질의 사고가 같은 사각지대). 목표 1 셀에
 * 서로 다른 응답 두 건의 제출을 동시에 보내 정확히 하나만 completed, 다른 하나는 quotaful_out
 * 이고 답변은 둘 다 저장돼 있는지를 실 Postgres 의 advisory lock 으로 확인한다.
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요). 워크트리 공용 DB 라 실행 전 상태 확인.
 */
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { surveys, surveyVersions, surveyResponses } from '@/db/schema';
import type { QuotaConfig } from '@/shared/contracts/quota';
import type { QuestionData, SurveyVersionSnapshot } from '@/shared/contracts/survey';
import { completeResponse } from '@/server/survey-response/services/response-completion';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];
const GATE_QID = 'q-gender';

function buildSnapshot(): SurveyVersionSnapshot {
  const questions: QuestionData[] = [
    {
      id: GATE_QID,
      type: 'radio',
      title: '성별',
      required: true,
      order: 0,
      options: [
        { id: 'opt-m', label: '남', value: '남' },
        { id: 'opt-f', label: '여', value: '여' },
      ],
    },
  ];
  return {
    title: '진행 중 마감 경합 테스트',
    description: '',
    groups: [],
    settings: {
      isPublic: true,
      allowMultipleResponses: true,
      showProgressBar: false,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '',
    },
    questions,
  };
}

function plan(midSurveyClose: boolean): QuotaConfig {
  return {
    enabled: true,
    dimensions: [
      {
        id: 'dim-gender',
        questionId: GATE_QID,
        label: '성별',
        kind: 'choice',
        categories: [{ id: 'cat-m', label: '남', values: ['남'] }],
      },
    ],
    cells: [{ categoryIds: ['cat-m'], target: 1 }],
    closedMessage: '마감되었습니다.',
    midSurveyClose,
    midSurveyClosedMessage: midSurveyClose ? '죄송합니다. 응답 중 마감되었습니다.' : null,
  };
}

async function seed(midSurveyClose: boolean, responseCount: number) {
  const [survey] = await db
    .insert(surveys)
    .values({ title: '진행 중 마감 경합', status: 'published', quotaConfig: plan(midSurveyClose) })
    .returning();
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);

  const [version] = await db
    .insert(surveyVersions)
    .values({
      surveyId: survey.id,
      versionNumber: 1,
      status: 'published',
      snapshot: buildSnapshot(),
      publishedAt: new Date(),
    })
    .returning();
  if (!version) throw new Error('버전 시드 실패');

  const responseIds: string[] = [];
  for (let i = 0; i < responseCount; i += 1) {
    const [response] = await db
      .insert(surveyResponses)
      .values({
        surveyId: survey.id,
        versionId: version.id,
        sessionId: `seed-${crypto.randomUUID()}`,
        status: 'in_progress',
        isCompleted: false,
        questionResponses: {},
      })
      .returning();
    if (!response) throw new Error('응답 시드 실패');
    responseIds.push(response.id);
  }
  return { surveyId: survey.id, responseIds };
}

async function loadRows(responseIds: string[]) {
  const rows = await db
    .select({
      id: surveyResponses.id,
      status: surveyResponses.status,
      isCompleted: surveyResponses.isCompleted,
      completedAt: surveyResponses.completedAt,
      questionResponses: surveyResponses.questionResponses,
      metadata: surveyResponses.metadata,
    })
    .from(surveyResponses)
    .where(inArray(surveyResponses.id, responseIds));
  return rows;
}

describe.skipIf(!isLocalDb)('쿼터 진행 중 마감 — 실DB 경합', () => {
  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      await db.delete(surveyResponses).where(inArray(surveyResponses.surveyId, createdSurveyIds));
      await db.delete(surveyVersions).where(inArray(surveyVersions.surveyId, createdSurveyIds));
      await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
    }
  });

  it('목표 1 셀에 두 제출이 동시에 오면 정확히 하나만 완료되고 다른 하나는 쿼터마감이다 — 답변은 둘 다 저장', async () => {
    const { responseIds } = await seed(true, 2);
    const [a, b] = responseIds as [string, string];

    const results = await Promise.all([
      completeResponse({ responseId: a, data: { questionResponses: { [GATE_QID]: '남' } } }),
      completeResponse({ responseId: b, data: { questionResponses: { [GATE_QID]: '남' } } }),
    ]);

    const closed = results.filter((r) => 'kind' in r && r.kind === 'quota_closed');
    expect(closed).toHaveLength(1);
    expect(closed[0]).toEqual({
      kind: 'quota_closed',
      closedMessage: '죄송합니다. 응답 중 마감되었습니다.',
    });

    const rows = await loadRows(responseIds);
    const statuses = rows.map((r) => r.status).sort();
    expect(statuses).toEqual(['completed', 'quotaful_out']);
    for (const row of rows) {
      expect(row.questionResponses).toEqual({ [GATE_QID]: '남' });
      if (row.status === 'quotaful_out') {
        expect(row.isCompleted).toBe(false);
        expect(row.completedAt).toBeNull();
      } else {
        expect(row.isCompleted).toBe(true);
        expect(row.completedAt).not.toBeNull();
      }
    }
  });

  it('옵션이 꺼진 설문은 둘 다 완료되고 뒤쪽에 초과 표식이 남는다 — 종전 동작 회귀', async () => {
    const { responseIds } = await seed(false, 2);
    const [a, b] = responseIds as [string, string];

    // 종전 정책은 "완주자 수용" 이라 순서대로 오면 뒤쪽이 초과분이다.
    await completeResponse({ responseId: a, data: { questionResponses: { [GATE_QID]: '남' } } });
    await completeResponse({ responseId: b, data: { questionResponses: { [GATE_QID]: '남' } } });

    const rows = await loadRows(responseIds);
    expect(rows.map((r) => r.status)).toEqual(['completed', 'completed']);
    const later = rows.find((r) => r.id === b);
    const earlier = rows.find((r) => r.id === a);
    expect(later?.metadata?.['quotaOverflow']).toBe(true);
    expect(earlier?.metadata?.['quotaOverflow']).toBeUndefined();
  });
});
