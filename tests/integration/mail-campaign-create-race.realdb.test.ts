import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

const resultCodeGate = vi.hoisted(() => ({
  entered: null as (() => void) | null,
  wait: null as Promise<void> | null,
  release: null as (() => void) | null,
}));

vi.mock('@/lib/crypto/aes', () => ({
  decryptPii: vi.fn(() => 'qa@example.com'),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn(async () => undefined) },
}));

vi.mock('@/lib/operations/result-code-statuses.server', async () => {
  const { mockBuildNegativeCodeExists } = await import('./_helpers/result-code-mock');
  return {
    getResultCodeStatuses: vi.fn(async () => {
      resultCodeGate.entered?.();
      if (resultCodeGate.wait) await resultCodeGate.wait;
      return { positive: [], negative: [] };
    }),
    buildNegativeCodeExists: mockBuildNegativeCodeExists,
  };
});

import { db } from '@/db';
import { createCampaign } from '@/features/mail/server/services/mail-campaigns.service';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;
const surveyIds: string[] = [];
const OPERATION_TIMEOUT_MS = 10_000;
const OBSERVATION_TIMEOUT_MS = 10_000;
const CLEANUP_SETTLE_TIMEOUT_MS = 20_000;
const FORCE_CLEANUP_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 90_000;
const SQL_TIMEOUT_MS = 15_000;
const SQL_CLOSE_TIMEOUT_SECONDS = 1;

interface CampaignFixture {
  surveyId: string;
  templateId: string;
  realTargetId: string;
  testTargetId: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = OPERATION_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} 대기 시간 초과`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function holdAtResultCodeLookup() {
  const entered = deferred<void>();
  const released = deferred<void>();
  resultCodeGate.entered = () => entered.resolve();
  resultCodeGate.wait = released.promise;
  resultCodeGate.release = () => released.resolve();
  return {
    entered: () => withTimeout(entered.promise, '첫 캠페인의 회차 발번 이후 진입'),
    release: () => released.resolve(),
  };
}

function createDedicatedSql() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL 환경 변수가 설정되지 않았습니다.');
  return postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
    connection: {
      statement_timeout: SQL_TIMEOUT_MS,
      lock_timeout: SQL_TIMEOUT_MS,
      idle_in_transaction_session_timeout: SQL_TIMEOUT_MS,
    },
  });
}

function observeCreateTransactionPids() {
  const originalTransaction = db.transaction.bind(db);
  const pidSlots = [deferred<number>(), deferred<number>()] as const;
  const capturedPids: number[] = [];
  let callIndex = 0;
  const transactionSpy = vi.spyOn(db, 'transaction');

  transactionSpy.mockImplementation((async (callback, config) => {
    const index = callIndex++;
    const pidSlot = pidSlots[index];
    if (!pidSlot) throw new Error('예상보다 많은 campaign transaction이 시작되었습니다.');
    return originalTransaction(async (tx) => {
      const rows = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid()::int AS pid`);
      const pid = rows[0]?.pid;
      if (!pid) throw new Error('캠페인 생성 transaction backend PID를 얻지 못했습니다.');
      capturedPids.push(pid);
      pidSlot.resolve(pid);
      return callback(tx);
    }, config);
  }) as typeof db.transaction);

  return {
    pidAt: (index: 0 | 1) => withTimeout(pidSlots[index].promise, `${index + 1}번째 캠페인 transaction PID`),
    pids: () => [...capturedPids],
    restore: () => transactionSpy.mockRestore(),
  };
}

async function closeSqlClients(
  clients: Array<ReturnType<typeof postgres>>,
  label: string,
): Promise<void> {
  const results = await Promise.allSettled(
    clients.map((client) => client.end({ timeout: SQL_CLOSE_TIMEOUT_SECONDS })),
  );
  const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (errors.length > 0) throw new AggregateError(errors, `${label} 연결 종료에 실패했습니다.`);
}

async function settleOperations(args: {
  operations: Array<Promise<unknown>>;
  observer: ReturnType<typeof postgres>;
  transactionPids: number[];
  label: string;
}): Promise<void> {
  if (args.operations.length === 0) return;
  const settlement = Promise.allSettled(args.operations);

  try {
    await withTimeout(settlement, `${args.label} cleanup`, CLEANUP_SETTLE_TIMEOUT_MS);
  } catch (cleanupError) {
    const terminationResults = await Promise.allSettled(
      args.transactionPids.map(async (pid) => {
        await args.observer`SELECT pg_terminate_backend(${pid})`;
      }),
    );
    const terminationErrors = terminationResults.flatMap(
      (result) => result.status === 'rejected' ? [result.reason] : [],
    );

    try {
      await withTimeout(
        settlement,
        `${args.label} backend 종료 후 cleanup`,
        FORCE_CLEANUP_TIMEOUT_MS,
      );
    } catch (forcedCleanupError) {
      throw new AggregateError(
        [cleanupError, forcedCleanupError, ...terminationErrors],
        `${args.label} cleanup에 실패했습니다.`,
      );
    }

    throw new AggregateError(
      [cleanupError, ...terminationErrors],
      `${args.label} cleanup timeout으로 backend를 종료했습니다.`,
    );
  }
}

async function waitUntilBlockedBy(
  observer: ReturnType<typeof postgres>,
  args: {
    blockedPid: number;
    blockingPid: number;
    expectedLockType?: 'advisory';
  },
): Promise<void> {
  const deadline = Date.now() + OBSERVATION_TIMEOUT_MS;
  let lastSnapshot: unknown = null;

  while (Date.now() < deadline) {
    const rows = await observer<{
      blocking_pids: number[];
      waiting_lock_types: string[];
      wait_event_type: string | null;
      wait_event: string | null;
    }[]>`
      SELECT
        pg_blocking_pids(${args.blockedPid})::int[] AS blocking_pids,
        COALESCE(
          ARRAY(
            SELECT locktype
            FROM pg_locks
            WHERE pid=${args.blockedPid} AND NOT granted
          ),
          ARRAY[]::text[]
        ) AS waiting_lock_types,
        wait_event_type,
        wait_event
      FROM pg_stat_activity
      WHERE pid=${args.blockedPid}
    `;
    const snapshot = rows[0];
    lastSnapshot = snapshot ?? null;
    const blockedByExpectedBackend = snapshot?.blocking_pids.includes(args.blockingPid) ?? false;
    const waitingOnExpectedLock = args.expectedLockType === undefined
      || snapshot?.waiting_lock_types.includes(args.expectedLockType) === true;
    if (blockedByExpectedBackend && waitingOnExpectedLock) return;

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(
    `backend ${args.blockedPid}가 ${args.blockingPid}에 차단된 상태를 관찰하지 못했습니다: ${JSON.stringify(lastSnapshot)}`,
  );
}

async function seedCampaignFixture(): Promise<CampaignFixture> {
  const surveyId = randomUUID();
  const templateId = randomUUID();
  const realTargetId = randomUUID();
  const testTargetId = randomUUID();
  surveyIds.push(surveyId);

  await db.execute(sql`
    INSERT INTO surveys (id,title,test_mode_enabled)
    VALUES (${surveyId},'campaign-race',true)
  `);
  await db.execute(sql`
    INSERT INTO mail_templates (
      id,survey_id,name,subject,body_html,from_local,from_name
    ) VALUES (
      ${templateId},${surveyId},'template','subject','<p>body</p>','noreply','sender'
    )
  `);
  await db.execute(sql`
    INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code)
    VALUES (${realTargetId},${surveyId},1,false,${randomUUID()}),
           (${testTargetId},${surveyId},1,true,${randomUUID()})
  `);
  await db.execute(sql`
    INSERT INTO contact_pii (
      contact_target_id,field_type,column_key,cipher,blind_index
    ) VALUES (${realTargetId},'email','email','cipher','real-index'),
             (${testTargetId},'email','email','cipher','test-index')
  `);

  return { surveyId, templateId, realTargetId, testTargetId };
}

function campaignInput(
  fixture: CampaignFixture,
  targetId: string,
  title: string,
) {
  return {
    surveyId: fixture.surveyId,
    mailTemplateId: fixture.templateId,
    title,
    contactTargetIds: [targetId],
  };
}

run('메일 캠페인 생성 DB 경쟁', () => {
  afterEach(async () => {
    resultCodeGate.release?.();
    resultCodeGate.entered = null;
    resultCodeGate.wait = null;
    resultCodeGate.release = null;
    vi.restoreAllMocks();
    while (surveyIds.length > 0) {
      const surveyId = surveyIds.pop();
      if (surveyId) await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
    }
  });

  it('동시 생성은 scope별로 중복 없는 회차를 발번한다', async () => {
    const fixture = await seedCampaignFixture();
    const observer = createDedicatedSql();
    const observedTransactions = observeCreateTransactionPids();
    const gate = holdAtResultCodeLookup();
    const creations: Array<Promise<unknown>> = [];

    try {
      const firstCreation = createCampaign(
        campaignInput(fixture, fixture.testTargetId, 'test-a'),
        randomUUID(),
      );
      creations.push(firstCreation);
      const firstPid = await observedTransactions.pidAt(0);
      await gate.entered();

      const secondCreation = createCampaign(
        campaignInput(fixture, fixture.testTargetId, 'test-b'),
        randomUUID(),
      );
      creations.push(secondCreation);
      const secondPid = await observedTransactions.pidAt(1);
      await waitUntilBlockedBy(observer, {
        blockedPid: secondPid,
        blockingPid: firstPid,
        expectedLockType: 'advisory',
      });

      gate.release();
      await withTimeout(Promise.all(creations), '동시 캠페인 생성 완료');
    } finally {
      gate.release();
      try {
        await settleOperations({
          operations: creations,
          observer,
          transactionPids: observedTransactions.pids(),
          label: '동시 캠페인 생성',
        });
      } finally {
        try {
          observedTransactions.restore();
        } finally {
          await closeSqlClients([observer], 'advisory lock observer');
        }
      }
    }

    await db.execute(
      sql`UPDATE surveys SET test_mode_enabled=false WHERE id=${fixture.surveyId}`,
    );
    await createCampaign(
      campaignInput(fixture, fixture.realTargetId, 'real-a'),
      randomUUID(),
    );

    const rows = await db.execute<{ is_test: boolean; run_number: number }>(sql`
      SELECT is_test,run_number
      FROM mail_campaigns
      WHERE survey_id=${fixture.surveyId}
      ORDER BY is_test,run_number
    `);
    expect(rows).toEqual([
      { is_test: false, run_number: 1 },
      { is_test: true, run_number: 1 },
      { is_test: true, run_number: 2 },
    ]);
  }, TEST_TIMEOUT_MS);

  it('모드 전환은 생성의 survey SHARE lock 뒤에 직렬화된다', async () => {
    const fixture = await seedCampaignFixture();
    const observer = createDedicatedSql();
    const modeFlipSql = createDedicatedSql();
    const observedTransactions = observeCreateTransactionPids();
    const gate = holdAtResultCodeLookup();
    const updaterPid = deferred<number>();
    const operations: Array<Promise<unknown>> = [];
    let creation: Promise<unknown> | null = null;
    let modeFlip: Promise<unknown> | null = null;
    try {
      creation = createCampaign(
        campaignInput(fixture, fixture.testTargetId, 'locked-test'),
        randomUUID(),
      );
      operations.push(creation);
      const creationPid = await observedTransactions.pidAt(0);
      await gate.entered();

      modeFlip = modeFlipSql.begin(async (connection) => {
        const rows = await connection<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        const pid = rows[0]?.pid;
        if (!pid) throw new Error('모드 전환 backend PID를 얻지 못했습니다.');
        updaterPid.resolve(pid);
        await connection`UPDATE surveys SET test_mode_enabled=false WHERE id=${fixture.surveyId}`;
      });
      operations.push(modeFlip);
      const blockedPid = await withTimeout(updaterPid.promise, '모드 전환 backend PID');
      await waitUntilBlockedBy(observer, { blockedPid, blockingPid: creationPid });

      gate.release();
      await withTimeout(Promise.all([creation, modeFlip]), '캠페인 생성과 모드 전환 완료');
    } finally {
      gate.release();
      try {
        await settleOperations({
          operations,
          observer,
          transactionPids: observedTransactions.pids(),
          label: '캠페인 생성과 모드 전환',
        });
      } finally {
        try {
          observedTransactions.restore();
        } finally {
          await closeSqlClients([observer, modeFlipSql], '모드 전환 test SQL');
        }
      }
    }

    const campaigns = await db.execute<{ is_test: boolean }>(sql`
      SELECT is_test FROM mail_campaigns WHERE survey_id=${fixture.surveyId}
    `);
    expect(campaigns).toEqual([{ is_test: true }]);
    await expect(
      createCampaign(
        campaignInput(fixture, fixture.testTargetId, 'stale-test'),
        randomUUID(),
      ),
    ).rejects.toThrow('화면을 새로고침');
  }, TEST_TIMEOUT_MS);
});
