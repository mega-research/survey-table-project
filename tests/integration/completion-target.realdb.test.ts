/**
 * 전체 완료 목표(`surveys.max_responses`) 제출 시점 하드 차단 — 실DB 경합 테스트.
 *
 * mock DB 는 직렬화를 검증하지 못한다. 목표의 마지막 자리에 서로 다른 응답의 제출을 동시에 보내
 * 완료가 정확히 목표 수에서 멈추는지, 막힌 응답이 열린 채 남는지를 실 Postgres 의 advisory lock
 * 으로 확인한다. 잠금이 코드에서 빠지면 제출들이 대기하지 않아 빨간불이 난다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<pnpm db:isolated 가 준 주소> pnpm exec vitest run <이 파일>
 */
import { inArray, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { surveys, surveyVersions, surveyResponses } from '@/db/schema';
import type { QuotaConfig } from '@/shared/contracts/quota';
import type { QuestionData, SurveyVersionSnapshot } from '@/shared/contracts/survey';
import { completeResponse } from '@/server/survey-response/services/response-completion';

import { backendPid, waitForLockWaitersBehind } from '../helpers/lock-waiters';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];
const QID = 'q-gender';
/** response-completion 의 COMPLETION_TARGET_LOCK_KEY 와 같은 글자 — 바뀌면 이 테스트가 잠금을 못 쥔다. */
const TARGET_LOCK_KEY = 'completion-target';

function buildSnapshot(): SurveyVersionSnapshot {
  const questions: QuestionData[] = [
    {
      id: QID,
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
    title: '전체 완료 목표 경합 테스트',
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

/** 남 셀 목표가 넉넉한 진행 중 마감 플랜 — 셀 잠금과 설문 잠금이 함께 잡히는 경우를 만든다. */
function roomyQuotaPlan(): QuotaConfig {
  return {
    enabled: true,
    dimensions: [
      {
        id: 'dim-gender',
        questionId: QID,
        label: '성별',
        kind: 'choice',
        categories: [{ id: 'cat-m', label: '남', values: ['남'] }],
      },
    ],
    cells: [{ categoryIds: ['cat-m'], target: 100 }],
    closedMessage: null,
    midSurveyClose: true,
    midSurveyClosedMessage: null,
  };
}

async function seed(options: {
  maxResponses: number | null;
  responseCount: number;
  quotaConfig?: QuotaConfig;
}) {
  const [survey] = await db
    .insert(surveys)
    .values({
      title: '전체 완료 목표 경합',
      status: 'published',
      maxResponses: options.maxResponses,
      quotaConfig: options.quotaConfig ?? null,
    })
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
  for (let i = 0; i < options.responseCount; i += 1) {
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

async function loadStatuses(responseIds: string[]) {
  const rows = await db
    .select({
      id: surveyResponses.id,
      status: surveyResponses.status,
      isCompleted: surveyResponses.isCompleted,
      completedAt: surveyResponses.completedAt,
    })
    .from(surveyResponses)
    .where(inArray(surveyResponses.id, responseIds));
  return rows;
}

/**
 * 설문 잠금을 미리 쥔 차단 트랜잭션 — 제출들이 같은 잠금을 기다리게 만들어 "동시" 를 우연이 아니라
 * 구조로 만든다. `locked` 는 그 백엔드 pid — 이 잠금 뒤에 줄 선 제출만 센다.
 */
function createTargetLockBlocker(surveyId: string) {
  let markLocked!: (pid: number) => void;
  const locked = new Promise<number>((resolve) => {
    markLocked = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${surveyId}), hashtext(${TARGET_LOCK_KEY}))`,
    );
    markLocked(await backendPid(tx));
    await released;
  });
  return { locked, release, done };
}

const answers = () => ({ data: { questionResponses: { [QID]: '남' } } });
const isBlocked = (r: unknown) =>
  typeof r === 'object' && r !== null && 'kind' in r && (r as { kind: string }).kind === 'blocked';

describe.skipIf(!isLocalDb)('전체 완료 목표 — 실DB 경합', () => {
  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      await db.delete(surveyResponses).where(inArray(surveyResponses.surveyId, createdSurveyIds));
      await db.delete(surveyVersions).where(inArray(surveyVersions.surveyId, createdSurveyIds));
      await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
    }
  });

  it('목표 1 에 두 제출이 동시에 오면 정확히 하나만 완료되고 다른 하나는 열린 채 모집 완료로 접힌다', async () => {
    const { surveyId, responseIds } = await seed({ maxResponses: 1, responseCount: 2 });
    const [a, b] = responseIds as [string, string];

    const blocker = createTargetLockBlocker(surveyId);
    const holder = await blocker.locked;
    const submissions = Promise.all([
      completeResponse({ responseId: a, ...answers() }),
      completeResponse({ responseId: b, ...answers() }),
    ]);
    let results: Awaited<typeof submissions>;
    try {
      await waitForLockWaitersBehind(
        holder,
        2,
        '설문 잠금 대기자 2개를 관찰하지 못했습니다 — 제출 경로에 전체 완료 목표 잠금이 없다',
      );
    } finally {
      blocker.release();
      results = await submissions;
      await blocker.done;
    }

    const blocked = results.filter(isBlocked);
    expect(blocked).toEqual([{ kind: 'blocked', reason: 'quota_closed' }]);

    const rows = await loadStatuses(responseIds);
    expect(rows.map((r) => r.status).sort()).toEqual(['completed', 'in_progress']);
    const open = rows.find((r) => r.status === 'in_progress');
    // 막힌 응답은 종결되지 않는다 — 목표를 올리면 그대로 이어 간다.
    expect(open?.isCompleted).toBe(false);
    expect(open?.completedAt).toBeNull();
  });

  it('목표를 올리면 막혔던 응답이 다시 제출해 완료된다', async () => {
    const { surveyId, responseIds } = await seed({ maxResponses: 1, responseCount: 2 });
    const [a, b] = responseIds as [string, string];

    await completeResponse({ responseId: a, ...answers() });
    await expect(completeResponse({ responseId: b, ...answers() })).resolves.toEqual({
      kind: 'blocked',
      reason: 'quota_closed',
    });

    await db.update(surveys).set({ maxResponses: 2 }).where(sql`${surveys.id} = ${surveyId}`);
    const retried = await completeResponse({ responseId: b, ...answers() });
    expect(isBlocked(retried)).toBe(false);

    const rows = await loadStatuses(responseIds);
    expect(rows.map((r) => r.status)).toEqual(['completed', 'completed']);
  });

  it('쿼터 진행 중 마감과 함께 켜져도 교착 없이 목표 수에서 멈춘다 — 설문 잠금 → 셀 잠금 순서', async () => {
    const { surveyId, responseIds } = await seed({
      maxResponses: 2,
      responseCount: 4,
      quotaConfig: roomyQuotaPlan(),
    });

    const blocker = createTargetLockBlocker(surveyId);
    const holder = await blocker.locked;
    const submissions = Promise.all(
      responseIds.map((responseId) => completeResponse({ responseId, ...answers() })),
    );
    let results: Awaited<typeof submissions>;
    try {
      // db 풀이 5 라 차단 트랜잭션 1 + 제출 4 가 한꺼번에 줄을 서지는 못한다 — 둘 이상만 본다.
      await waitForLockWaitersBehind(
        holder,
        2,
        '설문 잠금 대기자를 관찰하지 못했습니다 — 제출 경로에 전체 완료 목표 잠금이 없다',
      );
    } finally {
      blocker.release();
      results = await submissions;
      await blocker.done;
    }

    expect(results.filter(isBlocked)).toHaveLength(2);
    const rows = await loadStatuses(responseIds);
    expect(rows.filter((r) => r.status === 'completed')).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'in_progress')).toHaveLength(2);
  });

  it('목표가 없는 설문은 잠금 없이 전부 완료된다 — 종전 동작 회귀', async () => {
    const { responseIds } = await seed({ maxResponses: null, responseCount: 3 });

    const results = await Promise.all(
      responseIds.map((responseId) => completeResponse({ responseId, ...answers() })),
    );

    expect(results.filter(isBlocked)).toHaveLength(0);
    const rows = await loadStatuses(responseIds);
    expect(rows.map((r) => r.status)).toEqual(['completed', 'completed', 'completed']);
  });
});
