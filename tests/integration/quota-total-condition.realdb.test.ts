/**
 * 쿼터 「완료」 조건(`quota_config.totalTarget`) — 실DB 테스트 (CONTEXT.md 「완료 조건」).
 *
 * 설문 전체 완료 수(온라인 완료 + 실사 완료 처리)의 목표다. 문항에 묶이지 않을 뿐 다른 조건과 같은 쿼터
 * 플랜의 일부라 집행 스위치와 「진행 중 마감」 옵션을 따른다. mock DB 는 직렬화와 SQL 셈을 검증하지 못해
 * 실 Postgres 로 본다:
 *  - 진행 중 마감이 켜진 플랜의 제출은 설문 잠금 아래에서 정확히 목표 수에 멈춘다(잠금이 빠지면 빨간불)
 *  - 잠금을 기다리는 사이 바뀐 플랜이 그 제출에 적용된다
 *  - 실사 완료 처리가 전체 완료 수에 든다
 *  - 입장 판정(checkQuota)·쿼터마감 다시 열기가 같은 셈을 쓴다
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<pnpm db:isolated 가 준 주소> pnpm exec vitest run <이 파일>
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  contactAttempts,
  contactTargets,
  surveys,
  surveyVersions,
  surveyResponses,
} from '@/db/schema';
import { generateInviteCode } from '@/lib/survey-url';
import { checkQuota } from '@/server/quota/services/quota';
import { countQuotaTotalCompleted } from '@/server/read-models/quota-cell';
import { reopenQuotaClosedResponse } from '@/server/survey-response/services/quota-reopen';
import { completeResponse } from '@/server/survey-response/services/response-completion';
import type { QuotaConfig } from '@/shared/contracts/quota';
import type { QuestionData, SurveyVersionSnapshot } from '@/shared/contracts/survey';

import { backendPid, waitForLockWaitersBehind } from '../helpers/lock-waiters';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];
const QID = 'q-gender';
/** response-completion 의 QUOTA_TOTAL_LOCK_KEY 와 같은 글자 — 바뀌면 이 테스트가 잠금을 못 쥔다. */
const TOTAL_LOCK_KEY = 'quota-total';
const MID_MESSAGE = '죄송합니다. 응답 중 마감되었습니다.';

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
    title: '완료 조건 경합 테스트',
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

/** 「완료」 조건만 있는 플랜. 기본은 집행 중 + 진행 중 마감 켜짐(하드 차단). */
function totalPlan(totalTarget: number | null, over: Partial<QuotaConfig> = {}): QuotaConfig {
  return {
    enabled: true,
    dimensions: [],
    cells: [],
    totalTarget,
    closedMessage: '마감되었습니다.',
    midSurveyClose: true,
    midSurveyClosedMessage: MID_MESSAGE,
    ...over,
  };
}

/** 남 셀 목표가 넉넉한 조건을 함께 둔 플랜 — 셀 잠금과 설문 잠금이 함께 잡히는 경우를 만든다. */
function totalWithRoomyCellPlan(totalTarget: number): QuotaConfig {
  return totalPlan(totalTarget, {
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
  });
}

async function seed(quotaConfig: QuotaConfig, responseCount: number) {
  const [survey] = await db
    .insert(surveys)
    .values({ title: '완료 조건 경합', status: 'published', quotaConfig })
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

/** 실사 완료 처리 — 온라인 응답 없이 담당자가 완료 결과코드를 기록한 조사 대상. */
async function seedFieldworkCompleted(surveyId: string, resid: number) {
  const [target] = await db
    .insert(contactTargets)
    .values({ surveyId, resid, inviteCode: generateInviteCode() })
    .returning({ id: contactTargets.id });
  if (!target) throw new Error('조사 대상 시드 실패');
  await db
    .insert(contactAttempts)
    .values({ contactTargetId: target.id, attemptNo: 1, resultCode: '1.조사완료' });
  return target.id;
}

async function loadRows(responseIds: string[]) {
  return db
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
}

const setPlan = (surveyId: string, quotaConfig: QuotaConfig) =>
  db.update(surveys).set({ quotaConfig }).where(eq(surveys.id, surveyId));

/**
 * 설문 잠금을 미리 쥔 차단 트랜잭션 — 제출들이 같은 잠금을 기다리게 만들어 "동시" 를 우연이 아니라
 * 구조로 만든다. `locked` 는 그 백엔드 pid — 이 잠금 뒤에 줄 선 제출만 센다.
 */
function createTotalLockBlocker(surveyId: string) {
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
      sql`select pg_advisory_xact_lock(hashtext(${surveyId}), hashtext(${TOTAL_LOCK_KEY}))`,
    );
    markLocked(await backendPid(tx));
    await released;
  });
  return { locked, release, done };
}

/** 제출들이 설문 잠금 뒤에 줄 선 상태에서 `whileWaiting` 을 커밋하고 잠금을 푼다. */
async function submitBehindLock(
  surveyId: string,
  responseIds: string[],
  waiters: number,
  whileWaiting: () => Promise<unknown> = async () => undefined,
) {
  const blocker = createTotalLockBlocker(surveyId);
  const holder = await blocker.locked;
  const submissions = Promise.all(
    responseIds.map((responseId) => completeResponse({ responseId, ...answers() })),
  );
  let results: Awaited<typeof submissions>;
  try {
    await waitForLockWaitersBehind(
      holder,
      waiters,
      '설문 잠금 대기자를 관찰하지 못했습니다 — 제출 경로에 「완료」 조건 잠금이 없다',
    );
    await whileWaiting();
  } finally {
    blocker.release();
    results = await submissions;
    await blocker.done;
  }
  return results;
}

const answers = () => ({ data: { questionResponses: { [QID]: '남' } } });
/** 완료가 아니라 쿼터마감으로 끝난 제출. */
const isClosed = (r: unknown) =>
  typeof r === 'object' &&
  r !== null &&
  'kind' in r &&
  (r as { kind: string }).kind === 'quota_closed';
const QUOTA_CLOSED = { kind: 'quota_closed', closedMessage: MID_MESSAGE };

describe.skipIf(!isLocalDb)('쿼터 「완료」 조건 — 실DB', () => {
  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      // contact_attempts 는 contact_targets 삭제에 딸려 지워진다(ON DELETE CASCADE).
      await db.delete(surveyResponses).where(inArray(surveyResponses.surveyId, createdSurveyIds));
      await db.delete(contactTargets).where(inArray(contactTargets.surveyId, createdSurveyIds));
      await db.delete(surveyVersions).where(inArray(surveyVersions.surveyId, createdSurveyIds));
      await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
    }
  });

  describe('제출 시점 하드 차단 (진행 중 마감 켜짐)', () => {
    it('목표 1 에 두 제출이 동시에 오면 정확히 하나만 완료되고 다른 하나는 쿼터마감으로 끝난다', async () => {
      const { surveyId, responseIds } = await seed(totalPlan(1), 2);

      const results = await submitBehindLock(surveyId, responseIds, 2);

      expect(results.filter(isClosed)).toEqual([QUOTA_CLOSED]);
      const rows = await loadRows(responseIds);
      expect(rows.map((r) => r.status).sort()).toEqual(['completed', 'quotaful_out']);
      const closed = rows.find((r) => r.status === 'quotaful_out');
      // 쿼터 셀 마감과 같은 기록 — 완료가 아니고 완료 시각이 없으며 답은 남는다.
      expect(closed?.isCompleted).toBe(false);
      expect(closed?.completedAt).toBeNull();
      expect(closed?.questionResponses).toEqual({ [QID]: '남' });
    });

    it('셀 조건과 함께 있어도 교착 없이 목표 수에서 멈춘다 — 설문 잠금 → 셀 잠금 순서', async () => {
      const { surveyId, responseIds } = await seed(totalWithRoomyCellPlan(2), 4);

      // db 풀이 5 라 차단 트랜잭션 1 + 제출 4 가 한꺼번에 줄을 서지는 못한다 — 둘 이상만 본다.
      const results = await submitBehindLock(surveyId, responseIds, 2);

      expect(results.filter(isClosed)).toHaveLength(2);
      const rows = await loadRows(responseIds);
      expect(rows.filter((r) => r.status === 'completed')).toHaveLength(2);
      expect(rows.filter((r) => r.status === 'quotaful_out')).toHaveLength(2);
    });

    it('마지막 자리를 채운 응답이 다시 제출하면 쿼터마감이 아니라 이미 완료로 받는다', async () => {
      // 응답 유실로 다시 누르거나 다른 탭이 늦게 제출한 경우 — 그 사람은 완료자다.
      const { responseIds } = await seed(totalPlan(1), 1);
      const [a] = responseIds as [string];

      const first = await completeResponse({ responseId: a, ...answers() });
      expect(isClosed(first)).toBe(false);

      const retried = await completeResponse({ responseId: a, ...answers() });
      expect(retried).toMatchObject({ id: a, status: 'completed', alreadyCompleted: true });
    });

    it('같은 응답의 두 제출이 마지막 자리에 동시에 와도 하나는 완료, 하나는 이미 완료다', async () => {
      const { surveyId, responseIds } = await seed(totalPlan(1), 1);
      const [a] = responseIds as [string];

      const results = await submitBehindLock(surveyId, [a, a], 2);

      expect(results.filter(isClosed)).toHaveLength(0);
      expect(
        results.filter((r) => 'alreadyCompleted' in r && r.alreadyCompleted === true),
      ).toHaveLength(1);
      expect((await loadRows(responseIds)).map((r) => r.status)).toEqual(['completed']);
    });

    it('실사 완료 처리가 전체 완료 수에 든다 — 온라인 완료가 없어도 목표가 찼으면 막는다', async () => {
      const { surveyId, responseIds } = await seed(totalPlan(2), 1);
      const [a] = responseIds as [string];
      await seedFieldworkCompleted(surveyId, 1);
      await seedFieldworkCompleted(surveyId, 2);

      await expect(countQuotaTotalCompleted(db, surveyId)).resolves.toBe(2);
      await expect(completeResponse({ responseId: a, ...answers() })).resolves.toEqual(QUOTA_CLOSED);
    });

    it('온라인으로 완료한 대상의 완료 결과코드는 두 번 세지 않는다', async () => {
      const { surveyId, responseIds } = await seed(totalPlan(5), 1);
      const [a] = responseIds as [string];
      const targetId = await seedFieldworkCompleted(surveyId, 1);
      await db
        .update(surveyResponses)
        .set({ contactTargetId: targetId })
        .where(eq(surveyResponses.id, a));

      await expect(countQuotaTotalCompleted(db, surveyId)).resolves.toBe(1);
      await completeResponse({ responseId: a, ...answers() });
      // 같은 사람이 온라인으로도 완료했다 — 실사 완료 처리에서 빠지고 온라인 완료로만 센다.
      await expect(countQuotaTotalCompleted(db, surveyId)).resolves.toBe(1);
    });
  });

  describe('잠금을 기다리는 사이 바뀐 플랜', () => {
    it('내린 목표가 대기하던 제출에 적용된다 — 옛 목표까지 완료되지 않는다', async () => {
      const { surveyId, responseIds } = await seed(totalPlan(5), 2);

      const results = await submitBehindLock(surveyId, responseIds, 2, () =>
        setPlan(surveyId, totalPlan(1)),
      );

      expect(results.filter(isClosed)).toHaveLength(1);
      expect((await loadRows(responseIds)).map((r) => r.status).sort()).toEqual([
        'completed',
        'quotaful_out',
      ]);
    });

    it('올린 목표가 대기하던 제출에 적용된다 — 옛 목표로 막히지 않는다', async () => {
      const { surveyId, responseIds } = await seed(totalPlan(1), 2);
      const [a, b] = responseIds as [string, string];
      await completeResponse({ responseId: a, ...answers() });

      const results = await submitBehindLock(surveyId, [b], 1, () => setPlan(surveyId, totalPlan(2)));

      expect(results.filter(isClosed)).toHaveLength(0);
      expect((await loadRows(responseIds)).map((r) => r.status)).toEqual(['completed', 'completed']);
    });

    it('지운 조건·끈 집행은 대기하던 제출을 막지 않는다', async () => {
      const { surveyId, responseIds } = await seed(totalPlan(1), 3);
      const [a, b, c] = responseIds as [string, string, string];
      await completeResponse({ responseId: a, ...answers() });

      const removed = await submitBehindLock(surveyId, [b], 1, () => setPlan(surveyId, totalPlan(null)));
      expect(removed.filter(isClosed)).toHaveLength(0);

      await setPlan(surveyId, totalPlan(1));
      const disabled = await submitBehindLock(surveyId, [c], 1, () =>
        setPlan(surveyId, totalPlan(1, { enabled: false })),
      );
      expect(disabled.filter(isClosed)).toHaveLength(0);
      expect((await loadRows(responseIds)).map((r) => r.status)).toEqual([
        'completed',
        'completed',
        'completed',
      ]);
    });
  });

  describe('셀 조건과 함께 있을 때 — 잠금 아래에서 다시 읽은 플랜이 셀 판정에도 쓰인다', () => {
    /** 남 셀 목표 1(이미 찼다) + 완료 조건(넉넉함). 두 번째 제출은 셀에서 막힐 차례다. */
    const mixedPlan = (over: Partial<QuotaConfig> = {}): QuotaConfig =>
      totalPlan(10, {
        dimensions: [
          {
            id: 'dim-gender',
            questionId: QID,
            label: '성별',
            kind: 'choice',
            categories: [{ id: 'cat-m', label: '남', values: ['남'] }],
          },
        ],
        cells: [{ categoryIds: ['cat-m'], target: 1 }],
        ...over,
      });

    async function seedWithFullCell() {
      const { surveyId, responseIds } = await seed(mixedPlan(), 2);
      const [a, b] = responseIds as [string, string];
      await completeResponse({ responseId: a, ...answers() });
      return { surveyId, responseIds, waiting: b };
    }

    it('플랜이 그대로면 찬 셀에서 쿼터마감으로 끝난다 — 대조군', async () => {
      const { surveyId, responseIds, waiting } = await seedWithFullCell();

      const results = await submitBehindLock(surveyId, [waiting], 1);

      expect(results.filter(isClosed)).toHaveLength(1);
      expect((await loadRows(responseIds)).map((r) => r.status)).toEqual([
        'completed',
        'quotaful_out',
      ]);
    });

    it('대기 중 진행 중 마감을 끄면 셀도 막지 않는다 — 옛 플랜으로 쿼터마감하지 않는다', async () => {
      const { surveyId, responseIds, waiting } = await seedWithFullCell();

      const results = await submitBehindLock(surveyId, [waiting], 1, () =>
        setPlan(surveyId, mixedPlan({ midSurveyClose: false })),
      );

      expect(results.filter(isClosed)).toHaveLength(0);
      expect((await loadRows(responseIds)).map((r) => r.status)).toEqual(['completed', 'completed']);
    });

    it('대기 중 집행을 끄면 셀도 막지 않는다', async () => {
      const { surveyId, responseIds, waiting } = await seedWithFullCell();

      const results = await submitBehindLock(surveyId, [waiting], 1, () =>
        setPlan(surveyId, mixedPlan({ enabled: false })),
      );

      expect(results.filter(isClosed)).toHaveLength(0);
      expect((await loadRows(responseIds)).map((r) => r.status)).toEqual(['completed', 'completed']);
    });

    it('대기 중 셀 목표를 올리면 올린 목표로 판정한다', async () => {
      const { surveyId, responseIds, waiting } = await seedWithFullCell();

      const results = await submitBehindLock(surveyId, [waiting], 1, () =>
        setPlan(surveyId, mixedPlan({ cells: [{ categoryIds: ['cat-m'], target: 2 }] })),
      );

      expect(results.filter(isClosed)).toHaveLength(0);
      expect((await loadRows(responseIds)).map((r) => r.status)).toEqual(['completed', 'completed']);
    });

    it('대기 중 셀 조건을 지우면 그 셀로 막지 않는다', async () => {
      const { surveyId, responseIds, waiting } = await seedWithFullCell();

      const results = await submitBehindLock(surveyId, [waiting], 1, () =>
        setPlan(surveyId, mixedPlan({ dimensions: [], cells: [] })),
      );

      expect(results.filter(isClosed)).toHaveLength(0);
      expect((await loadRows(responseIds)).map((r) => r.status)).toEqual(['completed', 'completed']);
    });
  });

  describe('스위치를 따른다 — 다른 조건과 같은 규칙', () => {
    it('진행 중 마감이 꺼진 플랜은 제출을 막지 않고 초과 표식만 남긴다', async () => {
      const { responseIds } = await seed(totalPlan(1, { midSurveyClose: false }), 2);
      const [a, b] = responseIds as [string, string];

      await completeResponse({ responseId: a, ...answers() });
      const later = await completeResponse({ responseId: b, ...answers() });

      expect(isClosed(later)).toBe(false);
      const rows = await loadRows(responseIds);
      expect(rows.map((r) => r.status)).toEqual(['completed', 'completed']);
      expect(rows.find((r) => r.id === b)?.metadata?.['quotaOverflow']).toBe(true);
      expect(rows.find((r) => r.id === a)?.metadata?.['quotaOverflow']).toBeUndefined();
    });

    it('집행이 꺼진 플랜은 세지도 막지도 않는다', async () => {
      const { responseIds } = await seed(totalPlan(1, { enabled: false }), 2);

      const results = await Promise.all(
        responseIds.map((responseId) => completeResponse({ responseId, ...answers() })),
      );

      expect(results.filter(isClosed)).toHaveLength(0);
      const rows = await loadRows(responseIds);
      expect(rows.map((r) => r.status)).toEqual(['completed', 'completed']);
      expect(rows.some((r) => r.metadata?.['quotaOverflow'])).toBe(false);
    });

    it('「완료」 조건이 없는 플랜은 종전과 같다 — 전부 완료', async () => {
      const { responseIds } = await seed(totalPlan(null), 3);

      const results = await Promise.all(
        responseIds.map((responseId) => completeResponse({ responseId, ...answers() })),
      );

      expect(results.filter(isClosed)).toHaveLength(0);
      expect((await loadRows(responseIds)).map((r) => r.status)).toEqual([
        'completed',
        'completed',
        'completed',
      ]);
    });
  });

  describe('입장 판정과 다시 열기', () => {
    it('목표가 찬 뒤 들어온 응답자는 첫 확인에서 쿼터마감으로 기록된다 — 답이 없어도 판정한다', async () => {
      const { surveyId, responseIds } = await seed(totalPlan(1), 2);
      const [a, b] = responseIds as [string, string];
      await completeResponse({ responseId: a, ...answers() });

      await expect(checkQuota({ responseId: b, surveyId, answers: {} })).resolves.toEqual({
        blocked: true,
        closedMessage: '마감되었습니다.',
        midSurveyClosedMessage: MID_MESSAGE,
      });
      expect((await loadRows([b]))[0]?.status).toBe('quotaful_out');
    });

    it('목표가 찬 동안은 쿼터마감 응답을 다시 열지 않고, 목표를 올리면 재진입에서 열려 완료된다', async () => {
      const { surveyId, responseIds } = await seed(totalPlan(1), 2);
      const [a, b] = responseIds as [string, string];

      await completeResponse({ responseId: a, ...answers() });
      await expect(
        completeResponse({ responseId: b, data: { questionResponses: { [QID]: '여' } } }),
      ).resolves.toEqual(QUOTA_CLOSED);

      // 전체가 찬 동안 열면 다음 확인에서 다시 쿼터마감으로 떨어져 상태만 오간다.
      await expect(reopenQuotaClosedResponse(b)).resolves.toBe(false);
      // 쿼터마감 행의 늦은 제출은 여전히 쿼터마감 결과다.
      await expect(completeResponse({ responseId: b })).resolves.toEqual(QUOTA_CLOSED);

      await setPlan(surveyId, totalPlan(2));
      await expect(reopenQuotaClosedResponse(b)).resolves.toBe(true);
      // 막혔던 제출의 답이 남아 있다 — 페이로드 없이 완료해도 그 답으로 완료된다.
      const resumed = await completeResponse({ responseId: b });
      expect(isClosed(resumed)).toBe(false);
      const [row] = await loadRows([b]);
      expect(row?.status).toBe('completed');
      expect(row?.questionResponses).toEqual({ [QID]: '여' });
    });
  });
});
