/**
 * 쿼터 「진행 중 마감」 제출 시점 하드 차단 — 실DB 경합 테스트 (ADR 0025).
 *
 * mock DB 는 직렬화를 검증하지 못한다(9/21 고유 값 질의 사고가 같은 사각지대). 목표 1 셀에
 * 서로 다른 응답 두 건의 제출을 동시에 보내 정확히 하나만 completed, 다른 하나는 quotaful_out
 * 이고 답변은 둘 다 저장돼 있는지를 실 Postgres 의 advisory lock 으로 확인한다.
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요). 워크트리 공용 DB 라 실행 전 상태 확인.
 */
import { inArray, sql } from 'drizzle-orm';
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

/**
 * 셀 잠금을 미리 쥔 차단 트랜잭션 — 두 제출이 같은 잠금을 기다리게 만들어 "동시" 를 우연이 아니라
 * 구조로 만든다. 코드에서 잠금이 빠지면 두 제출이 대기하지 않고 각자 완료돼 빨간불이 난다.
 */
function createCellLockBlocker(surveyId: string, cellKey: string) {
  let markLocked!: () => void;
  const locked = new Promise<void>((resolve) => {
    markLocked = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${surveyId}), hashtext(${cellKey}))`);
    markLocked();
    await released;
  });
  return { locked, release, done };
}

async function waitForAdvisoryWaiters(minimum: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const rows = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname = current_database()
        AND wait_event_type = 'Lock'
        AND wait_event = 'advisory'
    `);
    if ((rows[0]?.waiting ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`셀 잠금 대기자 ${minimum}개를 관찰하지 못했습니다 — 제출 경로에 잠금이 없다`);
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
    const { surveyId, responseIds } = await seed(true, 2);
    const [a, b] = responseIds as [string, string];

    // 셀 키는 카테고리 id 를 이은 문자열(cellKeyOf) — 이 플랜은 차원 하나라 'cat-m'.
    const blocker = createCellLockBlocker(surveyId, 'cat-m');
    await blocker.locked;
    const submissions = Promise.all([
      completeResponse({ responseId: a, data: { questionResponses: { [GATE_QID]: '남' } } }),
      completeResponse({ responseId: b, data: { questionResponses: { [GATE_QID]: '남' } } }),
    ]);
    let results: Awaited<typeof submissions>;
    try {
      await waitForAdvisoryWaiters(2);
    } finally {
      blocker.release();
      results = await submissions;
      await blocker.done;
    }

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
