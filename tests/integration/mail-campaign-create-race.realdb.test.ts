import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { createCampaign } from '@/features/mail/server/services/mail-campaigns.service';

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

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;
const surveyIds: string[] = [];
const OPERATION_WAIT_BUDGET_MS = 10_000;
const LOCK_COORDINATION_STEP_COUNT = 3;
const LOCK_COORDINATION_BUDGET_MS =
  OPERATION_WAIT_BUDGET_MS * LOCK_COORDINATION_STEP_COUNT;
const LOCK_OBSERVATION_BUDGET_MS = 10_000;
const OBSERVER_STATEMENT_TIMEOUT_MS = 1_000;
const OBSERVER_QUERY_BUDGET_MS = 2_000;
const POST_LOCK_OPERATION_BUDGET_MS = 10_000;
const CAMPAIGN_TRANSACTION_STATEMENT_TIMEOUT_MS = 15_000;
const CAMPAIGN_OPERATION_BUDGET_MS = 20_000;
const CLEANUP_SETTLE_BUDGET_MS = 20_000;
const TERMINATION_QUERY_BUDGET_MS = 2_000;
const FORCED_CLEANUP_BUDGET_MS = 5_000;
const TEST_TIMEOUT_MARGIN_MS = 30_000;
const DEDICATED_SQL_TIMEOUT_MS = 15_000;
const HARNESS_STATEMENT_TIMEOUT_MS = 5_000;
const HARNESS_QUERY_BUDGET_MS = 10_000;
const SQL_CLOSE_TIMEOUT_SECONDS = 1;
const SQL_CLOSE_BUDGET_MS = 3_000;
const FIXTURE_QUERY_COUNT = 4;
const FIXTURE_TRANSACTION_BUDGET_MS = HARNESS_QUERY_BUDGET_MS * FIXTURE_QUERY_COUNT;
const FIXTURE_SETUP_BUDGET_MS = FIXTURE_TRANSACTION_BUDGET_MS + SQL_CLOSE_BUDGET_MS;
const POST_LOCK_ASSERTION_QUERY_COUNT = 2;
const POST_LOCK_ASSERTION_OPERATION_BUDGET_MS =
  HARNESS_QUERY_BUDGET_MS * POST_LOCK_ASSERTION_QUERY_COUNT
  + CAMPAIGN_OPERATION_BUDGET_MS;
const POST_LOCK_ASSERTION_BUDGET_MS =
  POST_LOCK_ASSERTION_OPERATION_BUDGET_MS + SQL_CLOSE_BUDGET_MS;
const FIXTURE_DELETE_BUDGET_MS = HARNESS_QUERY_BUDGET_MS + SQL_CLOSE_BUDGET_MS;
const AFTER_EACH_OPERATION_SETTLE_BUDGET_MS = 20_000;
const TEST_PHASE_BUDGET_MS =
  FIXTURE_SETUP_BUDGET_MS
  + LOCK_COORDINATION_BUDGET_MS
  + LOCK_OBSERVATION_BUDGET_MS
  + POST_LOCK_OPERATION_BUDGET_MS
  + CLEANUP_SETTLE_BUDGET_MS
  + TERMINATION_QUERY_BUDGET_MS
  + FORCED_CLEANUP_BUDGET_MS
  + SQL_CLOSE_BUDGET_MS
  + POST_LOCK_ASSERTION_BUDGET_MS;
const TEST_TIMEOUT_MS = TEST_PHASE_BUDGET_MS + TEST_TIMEOUT_MARGIN_MS;
const AFTER_EACH_TIMEOUT_MS =
  TEST_PHASE_BUDGET_MS
  + AFTER_EACH_OPERATION_SETTLE_BUDGET_MS
  + FIXTURE_DELETE_BUDGET_MS
  + TEST_TIMEOUT_MARGIN_MS;
const PID_REUSE_TEST_PHASE_BUDGET_MS =
  HARNESS_QUERY_BUDGET_MS * 3
  + TERMINATION_QUERY_BUDGET_MS
  + OBSERVER_QUERY_BUDGET_MS
  + FORCED_CLEANUP_BUDGET_MS
  + SQL_CLOSE_BUDGET_MS;
const PID_REUSE_TEST_TIMEOUT_MS =
  PID_REUSE_TEST_PHASE_BUDGET_MS + TEST_TIMEOUT_MARGIN_MS;
let activeTestCompletion: Promise<void> = Promise.resolve();
let activeOperationSettlement: Promise<void> = Promise.resolve();

interface CampaignFixture {
  surveyId: string;
  templateId: string;
  realTargetId: string;
  testTargetId: string;
}

interface TransactionIdentity {
  pid: number;
  xactStart: string;
}

interface TransactionIdentityRow {
  [key: string]: unknown;
  pid: number;
  xact_start: string;
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
  timeoutMs = OPERATION_WAIT_BUDGET_MS,
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

function toTransactionIdentity(
  row: TransactionIdentityRow | undefined,
  label: string,
): TransactionIdentity {
  if (!row) throw new Error(`${label} transaction identity를 얻지 못했습니다.`);
  return { pid: row.pid, xactStart: row.xact_start };
}

function trackOperation<T>(operation: Promise<T>): Promise<T> {
  const operationSettlement = operation.then(
    () => undefined,
    () => undefined,
  );
  activeOperationSettlement = Promise.all([
    activeOperationSettlement,
    operationSettlement,
  ]).then(() => undefined);
  return operation;
}

async function withTrackedTestCompletion<T>(callback: () => Promise<T>): Promise<T> {
  const completed = deferred<void>();
  activeTestCompletion = completed.promise;
  try {
    return await callback();
  } finally {
    completed.resolve();
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

function createDedicatedSql(statementTimeoutMs = DEDICATED_SQL_TIMEOUT_MS) {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL 환경 변수가 설정되지 않았습니다.');
  return postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
    connection: {
      statement_timeout: statementTimeoutMs,
      lock_timeout: statementTimeoutMs,
      idle_in_transaction_session_timeout: statementTimeoutMs,
    },
  });
}

function observeCreateTransactionIdentities() {
  const originalTransaction = db.transaction.bind(db);
  const identitySlots = [deferred<TransactionIdentity>(), deferred<TransactionIdentity>()] as const;
  const capturedIdentities: TransactionIdentity[] = [];
  let callIndex = 0;
  const transactionSpy = vi.spyOn(db, 'transaction');

  transactionSpy.mockImplementation((async (callback, config) => {
    const index = callIndex++;
    return originalTransaction(async (tx) => {
      await tx.execute(sql.raw(
        `SET LOCAL statement_timeout = '${CAMPAIGN_TRANSACTION_STATEMENT_TIMEOUT_MS}ms'`,
      ));
      const identitySlot = identitySlots[index];
      if (identitySlot) {
        const rows = await tx.execute<TransactionIdentityRow>(sql`
          SELECT
            pg_backend_pid()::int AS pid,
            transaction_timestamp()::text AS xact_start
        `);
        const identity = toTransactionIdentity(rows[0], '캠페인 생성');
        capturedIdentities.push(identity);
        identitySlot.resolve(identity);
      }
      return callback(tx);
    }, config);
  }) as typeof db.transaction);

  return {
    identityAt: (index: 0 | 1) => withTimeout(
      identitySlots[index].promise,
      `${index + 1}번째 캠페인 transaction identity`,
    ),
    identities: () => [...capturedIdentities],
    restore: () => transactionSpy.mockRestore(),
  };
}

async function closeSqlClients(
  clients: Array<ReturnType<typeof postgres>>,
  label: string,
): Promise<void> {
  const results = await withTimeout(
    Promise.allSettled(
      clients.map((client) => client.end({ timeout: SQL_CLOSE_TIMEOUT_SECONDS })),
    ),
    `${label} 연결 종료`,
    SQL_CLOSE_BUDGET_MS,
  );
  const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (errors.length > 0) throw new AggregateError(errors, `${label} 연결 종료에 실패했습니다.`);
}

async function runDedicatedSqlPhase<T>(args: {
  label: string;
  operationBudgetMs: number;
  statementTimeoutMs: number;
  run: (client: ReturnType<typeof postgres>) => Promise<T>;
}): Promise<T> {
  const client = createDedicatedSql(args.statementTimeoutMs);
  const errors: unknown[] = [];
  let value!: T;
  let succeeded = false;

  try {
    value = await withTimeout(args.run(client), args.label, args.operationBudgetMs);
    succeeded = true;
  } catch (error) {
    errors.push(error);
  }

  try {
    await closeSqlClients([client], `${args.label} 전용 SQL`);
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) throw new AggregateError(errors, `${args.label} phase에 실패했습니다.`);
  if (!succeeded) throw new Error(`${args.label} phase 결과를 얻지 못했습니다.`);
  return value;
}

async function terminateCapturedBackends(
  observer: ReturnType<typeof postgres>,
  backendIdentities: TransactionIdentity[],
  label: string,
): Promise<void> {
  const uniqueIdentities = [
    ...new Map(
      backendIdentities.map((identity) => [
        `${identity.pid}:${identity.xactStart}`,
        identity,
      ]),
    ).values(),
  ];
  if (uniqueIdentities.length === 0) return;

  const serializedIdentities = uniqueIdentities.map((identity) => ({
    pid: identity.pid,
    xact_start: identity.xactStart,
  }));
  await withTimeout(
    observer`
      WITH captured_transactions AS (
        SELECT pid, xact_start::timestamptz AS xact_start
        FROM jsonb_to_recordset(${observer.json(serializedIdentities)}::jsonb)
          AS captured(pid int, xact_start text)
      )
      SELECT pg_terminate_backend(activity.pid)
      FROM pg_stat_activity AS activity
      INNER JOIN captured_transactions AS captured
        ON captured.pid=activity.pid
       AND captured.xact_start=activity.xact_start
      WHERE activity.pid <> pg_backend_pid()
        AND activity.xact_start IS NOT NULL
    `,
    `${label} backend 일괄 종료`,
    TERMINATION_QUERY_BUDGET_MS,
  );
}

async function settleOperations(args: {
  operations: Array<Promise<unknown>>;
  observer: ReturnType<typeof postgres>;
  backendIdentities: () => TransactionIdentity[];
  label: string;
}): Promise<void> {
  if (args.operations.length === 0) return;
  const settlement = Promise.allSettled(args.operations);

  try {
    await withTimeout(settlement, `${args.label} cleanup`, CLEANUP_SETTLE_BUDGET_MS);
  } catch (cleanupError) {
    const terminationErrors: unknown[] = [];
    try {
      await terminateCapturedBackends(
        args.observer,
        args.backendIdentities(),
        args.label,
      );
    } catch (terminationError) {
      terminationErrors.push(terminationError);
    }

    try {
      await withTimeout(
        settlement,
        `${args.label} backend 종료 후 cleanup`,
        FORCED_CLEANUP_BUDGET_MS,
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
  const deadline = Date.now() + LOCK_OBSERVATION_BUDGET_MS;
  let lastSnapshot: unknown = null;

  while (Date.now() < deadline) {
    const rows = await withTimeout(
      observer<
        {
          blocking_pids: number[];
          waiting_lock_types: string[];
          wait_event_type: string | null;
          wait_event: string | null;
        }[]
      >`
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
      `,
      `backend ${args.blockedPid} blocker snapshot query`,
      OBSERVER_QUERY_BUDGET_MS,
    );
    const snapshot = rows[0];
    lastSnapshot = snapshot ?? null;
    const blockedByExpectedBackend = snapshot?.blocking_pids.includes(args.blockingPid) ?? false;
    const waitingOnExpectedLock =
      args.expectedLockType === undefined ||
      snapshot?.waiting_lock_types.includes(args.expectedLockType) === true;
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

  await runDedicatedSqlPhase({
    label: 'campaign fixture setup',
    operationBudgetMs: FIXTURE_TRANSACTION_BUDGET_MS,
    statementTimeoutMs: HARNESS_STATEMENT_TIMEOUT_MS,
    run: (fixtureSql) => fixtureSql.begin(async (connection) => {
      await withTimeout(connection`
        INSERT INTO surveys (id,title,test_mode_enabled)
        VALUES (${surveyId},'campaign-race',true)
      `, 'survey fixture insert', HARNESS_QUERY_BUDGET_MS);
      await withTimeout(connection`
        INSERT INTO mail_templates (
          id,survey_id,name,subject,body_html,from_local,from_name
        ) VALUES (
          ${templateId},${surveyId},'template','subject','<p>body</p>','noreply','sender'
        )
      `, 'mail template fixture insert', HARNESS_QUERY_BUDGET_MS);
      await withTimeout(connection`
        INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code)
        VALUES (${realTargetId},${surveyId},1,false,${randomUUID()}),
               (${testTargetId},${surveyId},1,true,${randomUUID()})
      `, 'contact target fixture insert', HARNESS_QUERY_BUDGET_MS);
      await withTimeout(connection`
        INSERT INTO contact_pii (
          contact_target_id,field_type,column_key,cipher,blind_index
        ) VALUES (${realTargetId},'email','email','cipher','real-index'),
                 (${testTargetId},'email','email','cipher','test-index')
      `, 'contact PII fixture insert', HARNESS_QUERY_BUDGET_MS);
    }),
  });

  return { surveyId, templateId, realTargetId, testTargetId };
}

async function deleteSurveyFixtures(): Promise<void> {
  const surveyIdsToDelete = surveyIds.splice(0);
  if (surveyIdsToDelete.length === 0) return;

  await runDedicatedSqlPhase({
    label: 'survey fixture delete',
    operationBudgetMs: HARNESS_QUERY_BUDGET_MS,
    statementTimeoutMs: HARNESS_STATEMENT_TIMEOUT_MS,
    run: async (cleanupSql) => {
      await withTimeout(cleanupSql`
        DELETE FROM surveys
        WHERE id IN (
          SELECT value::uuid
          FROM jsonb_array_elements_text(${cleanupSql.json(surveyIdsToDelete)}::jsonb)
        )
      `, 'survey fixture delete query', HARNESS_QUERY_BUDGET_MS);
    },
  });
}

async function collectCleanupError(
  errors: unknown[],
  label: string,
  cleanup: () => void | Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    errors.push(new AggregateError([error], `${label} cleanup에 실패했습니다.`));
  }
}

function campaignInput(fixture: CampaignFixture, targetId: string, title: string) {
  return {
    surveyId: fixture.surveyId,
    mailTemplateId: fixture.templateId,
    title,
    contactTargetIds: [targetId],
  };
}

run('메일 캠페인 생성 DB 경쟁', () => {
  afterEach(async () => {
    const cleanupErrors: unknown[] = [];

    await collectCleanupError(cleanupErrors, 'result-code gate 해제', () => {
      resultCodeGate.release?.();
    });
    await collectCleanupError(cleanupErrors, '테스트 callback 대기', () => withTimeout(
      activeTestCompletion,
      '테스트 callback 및 transaction cleanup',
      TEST_PHASE_BUDGET_MS,
    ));
    await collectCleanupError(cleanupErrors, '테스트 operation 대기', () => withTimeout(
      activeOperationSettlement,
      '테스트 operation 최종 settle',
      AFTER_EACH_OPERATION_SETTLE_BUDGET_MS,
    ));
    await collectCleanupError(cleanupErrors, 'test harness 상태 복구', () => {
      activeTestCompletion = Promise.resolve();
      activeOperationSettlement = Promise.resolve();
      resultCodeGate.entered = null;
      resultCodeGate.wait = null;
      resultCodeGate.release = null;
      vi.restoreAllMocks();
    });
    await collectCleanupError(
      cleanupErrors,
      'survey fixture 삭제',
      deleteSurveyFixtures,
    );

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'test harness cleanup에 실패했습니다.');
    }
  }, AFTER_EACH_TIMEOUT_MS);

  it('동시 생성은 scope별로 중복 없는 회차를 발번한다', () => withTrackedTestCompletion(async () => {
    const fixture = await seedCampaignFixture();
    const observer = createDedicatedSql(OBSERVER_STATEMENT_TIMEOUT_MS);
    const observedTransactions = observeCreateTransactionIdentities();
    const gate = holdAtResultCodeLookup();
    const creations: Array<Promise<unknown>> = [];

    try {
      try {
        const firstCreation = trackOperation(createCampaign(
          campaignInput(fixture, fixture.testTargetId, 'test-a'),
          randomUUID(),
        ));
        creations.push(firstCreation);
        const firstIdentity = await observedTransactions.identityAt(0);
        await gate.entered();

        const secondCreation = trackOperation(createCampaign(
          campaignInput(fixture, fixture.testTargetId, 'test-b'),
          randomUUID(),
        ));
        creations.push(secondCreation);
        const secondIdentity = await observedTransactions.identityAt(1);
        await waitUntilBlockedBy(observer, {
          blockedPid: secondIdentity.pid,
          blockingPid: firstIdentity.pid,
          expectedLockType: 'advisory',
        });

        gate.release();
        await withTimeout(
          Promise.all(creations),
          '동시 캠페인 생성 완료',
          POST_LOCK_OPERATION_BUDGET_MS,
        );
      } finally {
        gate.release();
        await settleOperations({
          operations: creations,
          observer,
          backendIdentities: observedTransactions.identities,
          label: '동시 캠페인 생성',
        });
      }

      await runDedicatedSqlPhase({
        label: 'scope별 campaign post-lock assertion',
        operationBudgetMs: POST_LOCK_ASSERTION_OPERATION_BUDGET_MS,
        statementTimeoutMs: HARNESS_STATEMENT_TIMEOUT_MS,
        run: async (assertionSql) => {
          await withTimeout(assertionSql`
            UPDATE surveys
            SET test_mode_enabled=false
            WHERE id=${fixture.surveyId}
          `, '실제 모드 전환 query', HARNESS_QUERY_BUDGET_MS);
          const realCreation = trackOperation(createCampaign(
            campaignInput(fixture, fixture.realTargetId, 'real-a'),
            randomUUID(),
          ));
          await withTimeout(
            realCreation,
            '실제 캠페인 생성 assertion',
            CAMPAIGN_OPERATION_BUDGET_MS,
          );

          const rows = await withTimeout(assertionSql<{
            is_test: boolean;
            run_number: number;
          }[]>`
            SELECT is_test,run_number
            FROM mail_campaigns
            WHERE survey_id=${fixture.surveyId}
            ORDER BY is_test,run_number
          `, 'scope별 campaign assertion query', HARNESS_QUERY_BUDGET_MS);
          expect(rows).toEqual([
            { is_test: false, run_number: 1 },
            { is_test: true, run_number: 1 },
            { is_test: true, run_number: 2 },
          ]);
        },
      });
    } finally {
      gate.release();
      try {
        observedTransactions.restore();
      } finally {
        await closeSqlClients([observer], 'advisory lock observer');
      }
    }
  }), TEST_TIMEOUT_MS);

  it('모드 전환은 생성의 survey SHARE lock 뒤에 직렬화된다', () => withTrackedTestCompletion(async () => {
    const fixture = await seedCampaignFixture();
    const observer = createDedicatedSql(OBSERVER_STATEMENT_TIMEOUT_MS);
    const modeFlipSql = createDedicatedSql();
    const observedTransactions = observeCreateTransactionIdentities();
    const gate = holdAtResultCodeLookup();
    const updaterIdentity = deferred<TransactionIdentity>();
    const operations: Array<Promise<unknown>> = [];
    let creation: Promise<unknown> | null = null;
    let modeFlip: Promise<unknown> | null = null;
    let capturedUpdaterIdentity: TransactionIdentity | null = null;
    try {
      try {
        creation = trackOperation(createCampaign(
          campaignInput(fixture, fixture.testTargetId, 'locked-test'),
          randomUUID(),
        ));
        operations.push(creation);
        const creationIdentity = await observedTransactions.identityAt(0);
        await gate.entered();

        modeFlip = trackOperation(modeFlipSql.begin(async (connection) => {
          const rows = await connection<TransactionIdentityRow[]>`
            SELECT
              pg_backend_pid()::int AS pid,
              transaction_timestamp()::text AS xact_start
          `;
          const identity = toTransactionIdentity(rows[0], '모드 전환');
          capturedUpdaterIdentity = identity;
          updaterIdentity.resolve(identity);
          await connection`
            UPDATE surveys
            SET test_mode_enabled=false
            WHERE id=${fixture.surveyId}
          `;
        }));
        operations.push(modeFlip);
        const blockedIdentity = await withTimeout(
          updaterIdentity.promise,
          '모드 전환 backend identity',
        );
        await waitUntilBlockedBy(observer, {
          blockedPid: blockedIdentity.pid,
          blockingPid: creationIdentity.pid,
        });

        gate.release();
        await withTimeout(
          Promise.all([creation, modeFlip]),
          '캠페인 생성과 모드 전환 완료',
          POST_LOCK_OPERATION_BUDGET_MS,
        );
      } finally {
        gate.release();
        await settleOperations({
          operations,
          observer,
          backendIdentities: () => [
            ...observedTransactions.identities(),
            ...(capturedUpdaterIdentity === null ? [] : [capturedUpdaterIdentity]),
          ],
          label: '캠페인 생성과 모드 전환',
        });
      }

      await runDedicatedSqlPhase({
        label: 'mode flip post-lock assertion',
        operationBudgetMs: POST_LOCK_ASSERTION_OPERATION_BUDGET_MS,
        statementTimeoutMs: HARNESS_STATEMENT_TIMEOUT_MS,
        run: async (assertionSql) => {
          const campaigns = await withTimeout(assertionSql<{ is_test: boolean }[]>`
            SELECT is_test
            FROM mail_campaigns
            WHERE survey_id=${fixture.surveyId}
          `, 'mode flip campaign assertion query', HARNESS_QUERY_BUDGET_MS);
          expect(campaigns).toEqual([{ is_test: true }]);

          const staleCreation = trackOperation(createCampaign(
            campaignInput(fixture, fixture.testTargetId, 'stale-test'),
            randomUUID(),
          ));
          await withTimeout(
            expect(staleCreation).rejects.toThrow('화면을 새로고침'),
            'stale test campaign rejection assertion',
            CAMPAIGN_OPERATION_BUDGET_MS,
          );
        },
      });
    } finally {
      gate.release();
      try {
        observedTransactions.restore();
      } finally {
        await closeSqlClients([observer, modeFlipSql], '모드 전환 test SQL');
      }
    }
  }), TEST_TIMEOUT_MS);

  it('종료 대상 PID가 재사용돼도 다음 transaction은 종료하지 않는다', () => withTrackedTestCompletion(async () => {
    const observer = createDedicatedSql(OBSERVER_STATEMENT_TIMEOUT_MS);
    const targetSql = createDedicatedSql(HARNESS_STATEMENT_TIMEOUT_MS);
    const secondTransactionEntered = deferred<TransactionIdentity>();
    const releaseSecondTransaction = deferred<void>();
    let secondTransaction: Promise<unknown> | null = null;

    try {
      const firstTransaction = await withTimeout(targetSql.begin(async (connection) => {
        const rows = await connection<TransactionIdentityRow[]>`
          SELECT
            pg_backend_pid()::int AS pid,
            transaction_timestamp()::text AS xact_start
        `;
        return toTransactionIdentity(rows[0], '첫 번째 PID 재사용 검증');
      }), '첫 번째 PID 재사용 transaction', HARNESS_QUERY_BUDGET_MS);
      await withTimeout(
        targetSql`SELECT pg_sleep(0.01)`,
        'PID 재사용 transaction 간격 query',
        HARNESS_QUERY_BUDGET_MS,
      );

      secondTransaction = trackOperation(targetSql.begin(async (connection) => {
        const rows = await connection<TransactionIdentityRow[]>`
          SELECT
            pg_backend_pid()::int AS pid,
            transaction_timestamp()::text AS xact_start
        `;
        const identity = toTransactionIdentity(rows[0], '두 번째 PID 재사용 검증');
        secondTransactionEntered.resolve(identity);
        await releaseSecondTransaction.promise;
      }));
      const secondTransactionIdentity = await withTimeout(
        secondTransactionEntered.promise,
        '두 번째 transaction identity',
      );
      expect(secondTransactionIdentity.pid).toBe(firstTransaction.pid);
      expect(secondTransactionIdentity.xactStart).not.toBe(firstTransaction.xactStart);

      await terminateCapturedBackends(observer, [firstTransaction], '재사용 PID 보호');

      const activeRows = await withTimeout(
        observer<TransactionIdentityRow[]>`
          SELECT pid::int AS pid, xact_start::text AS xact_start
          FROM pg_stat_activity
          WHERE pid=${secondTransactionIdentity.pid}
        `,
        '재사용 PID transaction 확인',
        OBSERVER_QUERY_BUDGET_MS,
      );
      expect(activeRows).toEqual([{
        pid: secondTransactionIdentity.pid,
        xact_start: secondTransactionIdentity.xactStart,
      }]);
    } finally {
      const cleanupErrors: unknown[] = [];
      releaseSecondTransaction.resolve();
      if (secondTransaction) {
        await collectCleanupError(
          cleanupErrors,
          '재사용 PID transaction settle',
          async () => {
            await withTimeout(
              Promise.allSettled([secondTransaction]),
              '재사용 PID transaction settle',
              FORCED_CLEANUP_BUDGET_MS,
            );
          },
        );
      }
      await collectCleanupError(cleanupErrors, '재사용 PID test SQL 종료', () =>
        closeSqlClients([observer, targetSql], '재사용 PID 보호 test SQL'));
      if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, '재사용 PID test cleanup에 실패했습니다.');
      }
    }
  }), PID_REUSE_TEST_TIMEOUT_MS);
});
