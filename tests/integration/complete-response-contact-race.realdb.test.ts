import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { db } from '@/db';
import { contactTargets } from '@/db/schema';
import { deleteContactTarget } from '@/features/contacts/server/services/contact-targets.service';
import { hardResetResponse } from '@/features/survey-response/server/services/response-manage.service';
import { completeResponse } from '@/features/survey-response/server/services/response.service';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

async function waitForTargetLockWaiters(minimum: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const rows = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%contact_targets%'
    `);
    if ((rows[0]?.waiting ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`contact_targets lock waiter ${minimum}개를 관찰하지 못했습니다`);
}

async function settleWithin(
  promises: readonly Promise<unknown>[],
  timeoutMs = 5_000,
): Promise<PromiseSettledResult<unknown>[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(promises),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`경쟁 작업 ${timeoutMs}ms timeout`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function createActualLinkedResponse(label: string): Promise<{
  surveyId: string;
  targetId: string;
  responseId: string;
}> {
  const surveyId = randomUUID();
  const targetId = randomUUID();
  const responseId = randomUUID();
  await db.execute(sql`
    INSERT INTO surveys (id,title,status,is_public,test_mode_enabled)
    VALUES (${surveyId},${label},'published',true,false)
  `);
  await db.execute(sql`
    INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code)
    VALUES (${targetId},${surveyId},1,false,${randomUUID()})
  `);
  await db.execute(sql`
    INSERT INTO survey_responses (
      id,survey_id,question_responses,is_test,contact_target_id,session_id,
      is_completed,status,started_at
    ) VALUES (
      ${responseId},${surveyId},'{}'::jsonb,false,${targetId},${randomUUID()},
      false,'in_progress',now()
    )
  `);
  await db.execute(sql`UPDATE contact_targets SET response_id=${responseId} WHERE id=${targetId}`);
  return { surveyId, targetId, responseId };
}

function createTargetBlocker(targetId: string): {
  locked: Promise<void>;
  release: () => void;
  done: Promise<void>;
} {
  let markLocked!: () => void;
  const locked = new Promise<void>((resolve) => {
    markLocked = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = db.transaction(async (tx) => {
    await tx
      .select({ id: contactTargets.id })
      .from(contactTargets)
      .where(eq(contactTargets.id, targetId))
      .for('update');
    markLocked();
    await released;
  });
  return { locked, release, done };
}

run('실제 대상자 응답 완료와 관리 작업 경쟁', () => {
  it('컨택 삭제와 완료가 역순 락 없이 종료되고 완료 응답은 rollback되지 않는다', async () => {
    const { surveyId, targetId, responseId } = await createActualLinkedResponse(
      'actual-complete-delete-race',
    );
    const blocker = createTargetBlocker(targetId);
    try {
      await blocker.locked;
      const deletion = deleteContactTarget({ surveyId, id: targetId });
      await waitForTargetLockWaiters(1);
      const completion = completeResponse({ responseId });
      await waitForTargetLockWaiters(2);
      blocker.release();

      const outcomes = await settleWithin([completion, deletion] as const);
      await blocker.done;
      expect(outcomes).toEqual([
        expect.objectContaining({ status: 'fulfilled' }),
        expect.objectContaining({ status: 'fulfilled' }),
      ]);

      const state = await db.execute<{
        response_status: string;
        is_completed: boolean;
        contact_target_id: string | null;
        target_exists: boolean;
        dangling_links: number;
      }>(sql`
        SELECT
          sr.status AS response_status,
          sr.is_completed,
          sr.contact_target_id,
          EXISTS(SELECT 1 FROM contact_targets WHERE id=${targetId}) AS target_exists,
          (
            SELECT count(*)::int
            FROM contact_targets ct
            LEFT JOIN survey_responses linked ON linked.id=ct.response_id
            WHERE ct.survey_id=${surveyId} AND ct.response_id IS NOT NULL AND linked.id IS NULL
          ) AS dangling_links
        FROM survey_responses sr
        WHERE sr.id=${responseId}
      `);
      // 허용 결과: 삭제가 최종 승자이므로 대상자는 사라지고, 먼저 커밋된 완료 응답은
      // FK SET NULL 상태로 보존된다. 응답 완료 rollback이나 dangling FK는 허용하지 않는다.
      expect(state[0]).toEqual({
        response_status: 'completed',
        is_completed: true,
        contact_target_id: null,
        target_exists: false,
        dangling_links: 0,
      });
    } finally {
      blocker.release();
      await blocker.done.catch(() => undefined);
      await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
    }
  });

  it('hard reset과 완료가 역순 락 없이 종료되고 최종 물리 삭제의 참조 무결성을 지킨다', async () => {
    const { surveyId, targetId, responseId } = await createActualLinkedResponse(
      'actual-complete-hard-reset-race',
    );
    const blocker = createTargetBlocker(targetId);
    try {
      await blocker.locked;
      const reset = hardResetResponse({ surveyId, responseId });
      await waitForTargetLockWaiters(1);
      const completion = completeResponse({ responseId });
      await waitForTargetLockWaiters(2);
      blocker.release();

      const outcomes = await settleWithin([completion, reset] as const);
      await blocker.done;
      expect(outcomes).toEqual([
        expect.objectContaining({ status: 'fulfilled' }),
        expect.objectContaining({ status: 'fulfilled' }),
      ]);

      const state = await db.execute<{
        response_exists: boolean;
        response_id: string | null;
        responded_at: Date | null;
        dangling_link: boolean;
      }>(sql`
        SELECT
          EXISTS(SELECT 1 FROM survey_responses WHERE id=${responseId}) AS response_exists,
          ct.response_id,
          ct.responded_at,
          (ct.response_id IS NOT NULL AND linked.id IS NULL) AS dangling_link
        FROM contact_targets ct
        LEFT JOIN survey_responses linked ON linked.id=ct.response_id
        WHERE ct.id=${targetId}
      `);
      // 허용 결과: hard reset이 최종 승자라 응답은 물리 삭제되고 target 링크도 비워진다.
      // 완료 후처리의 FK 실패는 완료 트랜잭션을 소급 rollback하지 않아야 한다.
      expect(state[0]).toEqual({
        response_exists: false,
        response_id: null,
        responded_at: null,
        dangling_link: false,
      });
    } finally {
      blocker.release();
      await blocker.done.catch(() => undefined);
      await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
    }
  });
});
