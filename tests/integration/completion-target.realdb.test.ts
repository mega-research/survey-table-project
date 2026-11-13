/**
 * 전체 완료 목표(`surveys.max_responses`) 제출 시점 하드 차단 — 실DB 경합 테스트.
 *
 * mock DB 는 직렬화를 검증하지 못한다. 목표의 마지막 자리에 서로 다른 응답의 제출을 동시에 보내
 * 완료가 정확히 목표 수에서 멈추는지, 막힌 응답이 쿼터마감으로 끝나고 자리가 나면 다시 열리는지를
 * 실 Postgres 의 advisory lock 으로 확인한다. 잠금이 코드에서 빠지면 제출들이 대기하지 않아 빨간불이 난다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<pnpm db:isolated 가 준 주소> pnpm exec vitest run <이 파일>
 */
import { inArray, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { surveys, surveyVersions, surveyResponses } from '@/db/schema';
import type { QuotaConfig } from '@/shared/contracts/quota';
import type { QuestionData, SurveyVersionSnapshot } from '@/shared/contracts/survey';
import { reopenQuotaClosedResponse } from '@/server/survey-response/services/quota-reopen';
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
      questionResponses: surveyResponses.questionResponses,
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
/** 완료가 아니라 쿼터마감으로 끝난 제출 — 전체 완료 목표에 막힌 결과는 쿼터 셀 마감과 같은 모양이다. */
const isBlocked = (r: unknown) =>
  typeof r === 'object' &&
  r !== null &&
  'kind' in r &&
  (r as { kind: string }).kind === 'quota_closed';
const QUOTA_CLOSED = { kind: 'quota_closed', closedMessage: null };

describe.skipIf(!isLocalDb)('전체 완료 목표 — 실DB 경합', () => {
  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      await db.delete(surveyResponses).where(inArray(surveyResponses.surveyId, createdSurveyIds));
      await db.delete(surveyVersions).where(inArray(surveyVersions.surveyId, createdSurveyIds));
      await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
    }
  });

  it('목표 1 에 두 제출이 동시에 오면 정확히 하나만 완료되고 다른 하나는 쿼터마감으로 끝난다', async () => {
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
    expect(blocked).toEqual([QUOTA_CLOSED]);

    const rows = await loadStatuses(responseIds);
    expect(rows.map((r) => r.status).sort()).toEqual(['completed', 'quotaful_out']);
    const closed = rows.find((r) => r.status === 'quotaful_out');
    // 쿼터 셀 마감과 같은 기록 — 완료가 아니고 완료 시각이 없으며 답은 남는다.
    expect(closed?.isCompleted).toBe(false);
    expect(closed?.completedAt).toBeNull();
    expect(closed?.questionResponses).toEqual({ [QID]: '남' });
  });

  it('목표가 찬 동안은 쿼터마감 응답을 다시 열지 않고, 목표를 올리면 재진입에서 열려 완료된다', async () => {
    const { surveyId, responseIds } = await seed({ maxResponses: 1, responseCount: 2 });
    const [a, b] = responseIds as [string, string];

    await completeResponse({ responseId: a, ...answers() });
    await expect(completeResponse({ responseId: b, ...answers() })).resolves.toEqual(QUOTA_CLOSED);

    // 쿼터 플랜이 없는 설문이다 — 전체 목표를 보지 않으면 「자리 있음」으로 열렸다가 다음 페이지에서
    // 다시 쿼터마감으로 떨어져 상태만 오간다.
    await expect(reopenQuotaClosedResponse(b)).resolves.toBe(false);
    // 쿼터마감 행의 늦은 제출은 여전히 쿼터마감 결과다.
    await expect(completeResponse({ responseId: b, ...answers() })).resolves.toEqual(QUOTA_CLOSED);

    await db.update(surveys).set({ maxResponses: 2 }).where(sql`${surveys.id} = ${surveyId}`);
    await expect(reopenQuotaClosedResponse(b)).resolves.toBe(true);
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
    expect(rows.filter((r) => r.status === 'quotaful_out')).toHaveLength(2);
  });

  it('마지막 자리를 채운 응답이 다시 제출하면 모집 완료가 아니라 이미 완료로 받는다', async () => {
    // 응답 유실로 다시 누르거나 다른 탭이 늦게 제출한 경우 — 그 사람은 완료자다. 목표가 찼다고
    // 「모집 완료」를 돌려주면 완료자가 마감 화면을 보고, 패널 설문은 쿼터 마감 주소로 보낸다.
    const { responseIds } = await seed({ maxResponses: 1, responseCount: 1 });
    const [a] = responseIds as [string];

    const first = await completeResponse({ responseId: a, ...answers() });
    expect(isBlocked(first)).toBe(false);

    const retried = await completeResponse({ responseId: a, ...answers() });
    expect(isBlocked(retried)).toBe(false);
    expect(retried).toMatchObject({ id: a, status: 'completed', alreadyCompleted: true });
  });

  it('같은 응답의 두 제출이 마지막 자리에 동시에 와도 하나는 완료, 하나는 이미 완료다', async () => {
    const { surveyId, responseIds } = await seed({ maxResponses: 1, responseCount: 1 });
    const [a] = responseIds as [string];

    const blocker = createTargetLockBlocker(surveyId);
    const holder = await blocker.locked;
    const submissions = Promise.all([
      completeResponse({ responseId: a, ...answers() }),
      completeResponse({ responseId: a, ...answers() }),
    ]);
    let results: Awaited<typeof submissions>;
    try {
      await waitForLockWaitersBehind(holder, 2, '설문 잠금 대기자 2개를 관찰하지 못했습니다');
    } finally {
      blocker.release();
      results = await submissions;
      await blocker.done;
    }

    expect(results.filter(isBlocked)).toHaveLength(0);
    expect(
      results.filter((r) => 'alreadyCompleted' in r && r.alreadyCompleted === true),
    ).toHaveLength(1);
    const rows = await loadStatuses(responseIds);
    expect(rows.map((r) => r.status)).toEqual(['completed']);
  });

  it('목표에 막힌 제출의 답은 저장된다 — 목표를 올리면 다시 열려 마지막 페이지 답까지 이어 간다', async () => {
    const { surveyId, responseIds } = await seed({ maxResponses: 1, responseCount: 2 });
    const [a, b] = responseIds as [string, string];

    await completeResponse({ responseId: a, ...answers() });
    // b 는 초안을 한 번도 저장하지 않은 채(저장분 {}) 마지막 페이지에서 제출했다.
    await expect(
      completeResponse({ responseId: b, data: { questionResponses: { [QID]: '여' } } }),
    ).resolves.toEqual(QUOTA_CLOSED);

    const [blockedRow] = (await loadStatuses([b])) as [Awaited<ReturnType<typeof loadStatuses>>[number]];
    expect(blockedRow.status).toBe('quotaful_out');
    expect(blockedRow.isCompleted).toBe(false);
    expect(blockedRow.completedAt).toBeNull();
    expect(blockedRow.questionResponses).toEqual({ [QID]: '여' });

    // 목표를 올리면 재진입에서 다시 열리고, 페이로드 없이 완료해도(저장분으로 확정) 그 답으로 완료된다.
    await db.update(surveys).set({ maxResponses: 2 }).where(sql`${surveys.id} = ${surveyId}`);
    await expect(reopenQuotaClosedResponse(b)).resolves.toBe(true);
    const resumed = await completeResponse({ responseId: b });
    expect(isBlocked(resumed)).toBe(false);
    const [doneRow] = (await loadStatuses([b])) as [Awaited<ReturnType<typeof loadStatuses>>[number]];
    expect(doneRow.status).toBe('completed');
    expect(doneRow.questionResponses).toEqual({ [QID]: '여' });
  });

  describe('잠금을 기다리는 사이 바뀐 목표', () => {
    /** 제출들이 설문 잠금 뒤에 줄 선 상태에서 `change` 를 커밋하고 잠금을 푼다. */
    async function submitWhileTargetChanges(
      surveyId: string,
      responseIds: string[],
      change: () => Promise<unknown>,
    ) {
      const blocker = createTargetLockBlocker(surveyId);
      const holder = await blocker.locked;
      const submissions = Promise.all(
        responseIds.map((responseId) => completeResponse({ responseId, ...answers() })),
      );
      let results: Awaited<typeof submissions>;
      try {
        await waitForLockWaitersBehind(
          holder,
          responseIds.length,
          '설문 잠금 대기자를 관찰하지 못했습니다 — 제출이 목표 잠금을 기다리지 않는다',
        );
        await change();
      } finally {
        blocker.release();
        results = await submissions;
        await blocker.done;
      }
      return results;
    }
    const setTarget = (surveyId: string, maxResponses: number | null) =>
      db.update(surveys).set({ maxResponses }).where(sql`${surveys.id} = ${surveyId}`);

    it('내린 목표가 대기하던 제출에 적용된다 — 옛 목표까지 완료되지 않는다', async () => {
      const { surveyId, responseIds } = await seed({ maxResponses: 5, responseCount: 2 });

      const results = await submitWhileTargetChanges(surveyId, responseIds, () =>
        setTarget(surveyId, 1),
      );

      expect(results.filter(isBlocked)).toHaveLength(1);
      const rows = await loadStatuses(responseIds);
      expect(rows.map((r) => r.status).sort()).toEqual(['completed', 'quotaful_out']);
    });

    it('올린 목표가 대기하던 제출에 적용된다 — 옛 목표로 막히지 않는다', async () => {
      const { surveyId, responseIds } = await seed({ maxResponses: 1, responseCount: 2 });
      const [a, b] = responseIds as [string, string];
      await completeResponse({ responseId: a, ...answers() });

      const results = await submitWhileTargetChanges(surveyId, [b], () => setTarget(surveyId, 2));

      expect(results.filter(isBlocked)).toHaveLength(0);
      const rows = await loadStatuses(responseIds);
      expect(rows.map((r) => r.status)).toEqual(['completed', 'completed']);
    });

    it('해제한 목표는 대기하던 제출을 막지 않는다', async () => {
      const { surveyId, responseIds } = await seed({ maxResponses: 1, responseCount: 2 });
      const [a, b] = responseIds as [string, string];
      await completeResponse({ responseId: a, ...answers() });

      const results = await submitWhileTargetChanges(surveyId, [b], () =>
        setTarget(surveyId, null),
      );

      expect(results.filter(isBlocked)).toHaveLength(0);
      const rows = await loadStatuses(responseIds);
      expect(rows.map((r) => r.status)).toEqual(['completed', 'completed']);
    });
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
