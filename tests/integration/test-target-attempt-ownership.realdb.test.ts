import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { contactTargets, surveys } from '@/db/schema';
import { prepareContactInsertScope } from '@/features/contacts/server/services/contact-insert-scope.service';
import {
  recordStepVisit,
  recordVisibilitySegment,
} from '@/features/survey-response/server/services/lifecycle.service';
import {
  completeResponse,
  saveTestTargetFirstAnswer,
} from '@/features/survey-response/server/services/response.service';
import {
  acquireTestTargetResponse,
  assertAnonymousTestSession,
  assertTestTargetAttemptOwner,
} from '@/lib/survey-response/test-target-attempt.server';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

async function waitForDatabaseLock(queryFragment: string, minimumWaiters = 1): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const rows = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE ${`%${queryFragment}%`}
    `);
    if ((rows[0]?.waiting ?? 0) >= minimumWaiters) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`${queryFragment} lock 대기를 관찰하지 못했습니다`);
}

run('조사대상자 테스트 모드 DB 제약', () => {
  const surveyId = randomUUID();
  const targetId = randomUUID();
  const responseId = randomUUID();
  const inviteCode = randomUUID();

  beforeAll(async () => {
    await db.execute(
      sql`INSERT INTO surveys (id,title,test_mode_enabled) VALUES (${surveyId},'test',true)`,
    );
    await db.execute(
      sql`INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code) VALUES (${targetId},${surveyId},1,true,${inviteCode})`,
    );
    await db.execute(
      sql`INSERT INTO survey_responses (id,survey_id,question_responses,is_test,contact_target_id,session_id) VALUES (${responseId},${surveyId},'{}',true,${targetId},${randomUUID()})`,
    );
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
  });

  it('같은 응답에는 active attempt 하나만 허용한다', async () => {
    await db.execute(
      sql`INSERT INTO test_response_attempts (id,response_id,session_id,status) VALUES (${randomUUID()},${responseId},'s1','active')`,
    );
    await expect(
      db.execute(
        sql`INSERT INTO test_response_attempts (id,response_id,session_id,status) VALUES (${randomUUID()},${responseId},'s2','active')`,
      ),
    ).rejects.toThrow();
  });

  it('실제와 테스트 resid는 각각 1부터 발번한다', async () => {
    const real = await db.execute<{ next_id: number }>(
      sql`SELECT next_contact_resid(${surveyId},false) AS next_id`,
    );
    const test = await db.execute<{ next_id: number }>(
      sql`SELECT next_contact_resid(${surveyId},true) AS next_id`,
    );
    expect(Number(real[0]?.next_id)).toBe(1);
    expect(Number(test[0]?.next_id)).toBe(2);
  });

  it('같은 테스트 대상자의 미삭제 응답은 하나만 허용하고 삭제 후 재생성을 허용한다', async () => {
    const replacementResponseId = randomUUID();
    const insertReplacement = () =>
      db.execute(
        sql`INSERT INTO survey_responses (id,survey_id,question_responses,is_test,contact_target_id,session_id) VALUES (${replacementResponseId},${surveyId},'{}',true,${targetId},${randomUUID()})`,
      );

    await expect(insertReplacement()).rejects.toThrow();

    await db.execute(sql`UPDATE survey_responses SET deleted_at=now() WHERE id=${responseId}`);
    await expect(insertReplacement()).resolves.toBeDefined();
  });
});

run('익명 테스트 저장과 첫 대상자 생성 경쟁', () => {
  it('익명 저장이 잡은 survey SHARE lock 뒤에 첫 대상자 생성이 직렬화되어 익명 응답이 남지 않는다', async () => {
    const surveyId = randomUUID();
    const targetId = randomUUID();
    const responseId = randomUUID();
    const testToken = randomUUID();
    await db.execute(sql`
      INSERT INTO surveys (id,title,test_mode_enabled,test_token)
      VALUES (${surveyId},'anonymous-race',true,${testToken})
    `);

    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    let releaseAnonymous!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseAnonymous = resolve;
    });

    try {
      const anonymousSave = db.transaction(async (tx) => {
        await assertAnonymousTestSession(tx, { surveyId, testToken });
        markLocked();
        await released;
        await tx.execute(sql`
          INSERT INTO survey_responses (
            id,survey_id,question_responses,is_test,contact_target_id,session_id
          ) VALUES (${responseId},${surveyId},'{}'::jsonb,true,null,'anonymous-race-session')
        `);
      });

      await locked;
      const targetCreate = db.transaction(async (tx) => {
        await prepareContactInsertScope(tx, {
          surveyId,
          requestedCount: 1,
          requireEmptyTestScope: false,
        });
        await tx.execute(sql`
          INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code)
          VALUES (${targetId},${surveyId},1,true,${randomUUID()})
        `);
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      releaseAnonymous();
      await Promise.all([anonymousSave, targetCreate]);

      const counts = await db.execute<{ anonymous_responses: number; targets: number }>(sql`
        SELECT
          (SELECT count(*)::int FROM survey_responses
            WHERE survey_id=${surveyId} AND is_test=true AND contact_target_id IS NULL) AS anonymous_responses,
          (SELECT count(*)::int FROM contact_targets
            WHERE survey_id=${surveyId} AND is_test=true) AS targets
      `);
      expect(counts[0]).toEqual({ anonymous_responses: 0, targets: 1 });
    } finally {
      releaseAnonymous();
      await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
    }
  });
});

run('기존 attempt 재사용 식별자 검증', () => {
  it('같은 attemptId라도 sessionId가 다르면 어떤 응답·컨택 쓰기 전 거부한다', async () => {
    const surveyId = randomUUID();
    const targetId = randomUUID();
    const responseId = randomUUID();
    const attemptId = randomUUID();
    const originalRespondedAt = new Date('2026-07-20T00:00:00.000Z');
    await db.execute(
      sql`INSERT INTO surveys (id,title,test_mode_enabled) VALUES (${surveyId},'attempt-identity',true)`,
    );
    await db.execute(sql`
      INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code,responded_at)
      VALUES (${targetId},${surveyId},1,true,${randomUUID()},${originalRespondedAt.toISOString()}::timestamptz)
    `);

    try {
      await db.execute(sql`
        INSERT INTO survey_responses (
          id,survey_id,question_responses,is_test,contact_target_id,session_id
        ) VALUES (${responseId},${surveyId},'{}'::jsonb,true,${targetId},'original-session')
      `);
      await db.execute(
        sql`UPDATE contact_targets SET response_id=${responseId} WHERE id=${targetId}`,
      );
      await db.execute(sql`
        INSERT INTO test_response_attempts (id,response_id,session_id,status)
        VALUES (${attemptId},${responseId},'original-session','active')
      `);

      await expect(
        db.transaction((tx) =>
          acquireTestTargetResponse(tx, {
            surveyId,
            contactTargetId: targetId,
            sessionId: 'forged-session',
            attemptId,
            versionId: null,
            currentStepId: 'forged-step',
          }),
        ),
      ).rejects.toThrow('테스트 세션이 다른 화면에서 시작되었습니다');

      const state = await db.execute<{
        session_id: string | null;
        current_step_id: string | null;
        response_id: string | null;
        responded_at: Date | null;
      }>(sql`
        SELECT sr.session_id, sr.current_step_id, ct.response_id, ct.responded_at
        FROM survey_responses sr
        JOIN contact_targets ct ON ct.id=sr.contact_target_id
        WHERE sr.id=${responseId}
      `);
      expect(state[0]).toMatchObject({
        session_id: 'original-session',
        current_step_id: null,
        response_id: responseId,
      });
      expect(new Date(String(state[0]?.responded_at)).toISOString()).toBe(
        originalRespondedAt.toISOString(),
      );
    } finally {
      await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
    }
  });
});

run('대상자 테스트 응답의 서버 현재 버전 고정', () => {
  it('caller가 null이나 이전 버전을 보내도 survey currentVersionId로 reset하고 유지한다', async () => {
    const surveyId = randomUUID();
    const targetId = randomUUID();
    const responseId = randomUUID();
    const oldVersionId = randomUUID();
    const currentVersionId = randomUUID();
    const firstAttemptId = randomUUID();
    const secondAttemptId = randomUUID();
    await db.execute(
      sql`INSERT INTO surveys (id,title,test_mode_enabled) VALUES (${surveyId},'fixed-version',true)`,
    );

    try {
      await db.execute(sql`
        INSERT INTO survey_versions (id,survey_id,version_number,status,snapshot)
        VALUES (${oldVersionId},${surveyId},1,'superseded','{"questions":[]}'::jsonb),
               (${currentVersionId},${surveyId},2,'published','{"questions":[]}'::jsonb)
      `);
      await db.execute(
        sql`UPDATE surveys SET current_version_id=${currentVersionId} WHERE id=${surveyId}`,
      );
      await db.execute(sql`
        INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code)
        VALUES (${targetId},${surveyId},1,true,${randomUUID()})
      `);
      await db.execute(sql`
        INSERT INTO survey_responses (
          id,survey_id,question_responses,is_test,contact_target_id,session_id,
          version_id,is_completed,status,completed_at
        ) VALUES (
          ${responseId},${surveyId},'{}'::jsonb,true,${targetId},'old-session',
          ${oldVersionId},true,'completed',now()
        )
      `);

      await db.transaction((tx) =>
        acquireTestTargetResponse(tx, {
          surveyId,
          contactTargetId: targetId,
          sessionId: 'null-version-session',
          attemptId: firstAttemptId,
          versionId: null,
          currentStepId: 'first-step',
        }),
      );
      let versionRows = await db.execute<{ version_id: string | null }>(
        sql`SELECT version_id FROM survey_responses WHERE id=${responseId}`,
      );
      expect(versionRows[0]?.version_id).toBe(currentVersionId);

      await db.transaction((tx) =>
        acquireTestTargetResponse(tx, {
          surveyId,
          contactTargetId: targetId,
          sessionId: 'old-version-session',
          attemptId: secondAttemptId,
          versionId: oldVersionId,
          currentStepId: 'second-step',
        }),
      );
      versionRows = await db.execute<{ version_id: string | null }>(
        sql`SELECT version_id FROM survey_responses WHERE id=${responseId}`,
      );
      expect(versionRows[0]?.version_id).toBe(currentVersionId);
    } finally {
      await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
    }
  });

  it('검증 중 publish가 끝나면 새 current 버전의 문항·PII·reset을 한 트랜잭션에서 사용한다', async () => {
    const surveyId = randomUUID();
    const targetId = randomUUID();
    const responseId = randomUUID();
    const oldVersionId = randomUUID();
    const newVersionId = randomUUID();
    const oldQuestionId = randomUUID();
    const newPiiQuestionId = randomUUID();
    const attemptId = randomUUID();
    const inviteToken = randomUUID();
    await db.execute(sql`
      INSERT INTO surveys (id,title,test_mode_enabled,status)
      VALUES (${surveyId},'publish-race',true,'published')
    `);

    let releasePublish!: () => void;
    const publishRelease = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    let markPublishLocked!: () => void;
    const publishLocked = new Promise<void>((resolve) => {
      markPublishLocked = resolve;
    });

    try {
      await db.execute(sql`
        INSERT INTO survey_versions (id,survey_id,version_number,status,snapshot)
        VALUES (
          ${oldVersionId},${surveyId},1,'superseded',
          ${JSON.stringify({ questions: [{ id: oldQuestionId, piiEncrypted: false }] })}::jsonb
        ),(
          ${newVersionId},${surveyId},2,'published',
          ${JSON.stringify({ questions: [{ id: newPiiQuestionId, piiEncrypted: true }] })}::jsonb
        )
      `);
      await db.execute(
        sql`UPDATE surveys SET current_version_id=${oldVersionId} WHERE id=${surveyId}`,
      );
      await db.execute(sql`
        INSERT INTO contact_targets (
          id,survey_id,resid,is_test,invite_token,invite_code,responded_at
        ) VALUES (${targetId},${surveyId},1,true,${inviteToken},${randomUUID()},now())
      `);
      await db.execute(sql`
        INSERT INTO survey_responses (
          id,survey_id,question_responses,is_test,contact_target_id,session_id,
          version_id,is_completed,status,completed_at
        ) VALUES (
          ${responseId},${surveyId},'{}'::jsonb,true,${targetId},'old-session',
          ${oldVersionId},true,'completed',now()
        )
      `);
      await db.execute(
        sql`UPDATE contact_targets SET response_id=${responseId} WHERE id=${targetId}`,
      );

      const publish = db.transaction(async (tx) => {
        await tx
          .update(surveys)
          .set({ currentVersionId: newVersionId })
          .where(eq(surveys.id, surveyId));
        markPublishLocked();
        await publishRelease;
      });
      await publishLocked;

      const create = saveTestTargetFirstAnswer({
        surveyId,
        contactTargetId: targetId,
        sessionId: 'new-current-session',
        versionId: oldVersionId,
        questionId: newPiiQuestionId,
        value: '암호화할 답변',
        currentStepId: 'new-current-step',
        attemptId,
      });
      await waitForDatabaseLock('surveys');
      releasePublish();

      await expect(create).resolves.toMatchObject({ responseId });
      await publish;
      const rows = await db.execute<{
        version_id: string | null;
        question_responses: Record<string, unknown>;
        session_id: string | null;
      }>(sql`
        SELECT version_id,question_responses,session_id
        FROM survey_responses WHERE id=${responseId}
      `);
      expect(rows[0]).toMatchObject({
        version_id: newVersionId,
        session_id: 'new-current-session',
      });
      expect(String(rows[0]?.question_responses[newPiiQuestionId])).toMatch(/^v1:/);
    } finally {
      releasePublish();
      await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
    }
  });
});

run('대상자 테스트 완료와 새 attempt reset 경쟁', () => {
  it('새 attempt가 먼저 target lock을 기다리면 stale 완료가 respondedAt을 되살리지 못한다', async () => {
    const surveyId = randomUUID();
    const targetId = randomUUID();
    const responseId = randomUUID();
    const staleAttemptId = randomUUID();
    const nextAttemptId = randomUUID();
    await db.execute(
      sql`INSERT INTO surveys (id,title,test_mode_enabled) VALUES (${surveyId},'complete-race',true)`,
    );
    await db.execute(sql`
      INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code,response_id)
      VALUES (${targetId},${surveyId},1,true,${randomUUID()},null)
    `);

    let releaseTarget!: () => void;
    const targetRelease = new Promise<void>((resolve) => {
      releaseTarget = resolve;
    });
    let markTargetLocked!: () => void;
    const targetLocked = new Promise<void>((resolve) => {
      markTargetLocked = resolve;
    });

    try {
      await db.execute(sql`
        INSERT INTO survey_responses (
          id,survey_id,question_responses,is_test,contact_target_id,session_id,status,is_completed
        ) VALUES (
          ${responseId},${surveyId},'{}'::jsonb,true,${targetId},'stale-session','in_progress',false
        )
      `);
      await db.execute(
        sql`UPDATE contact_targets SET response_id=${responseId} WHERE id=${targetId}`,
      );
      await db.execute(sql`
        INSERT INTO test_response_attempts (id,response_id,session_id,status)
        VALUES (${staleAttemptId},${responseId},'stale-session','active')
      `);

      const blocker = db.transaction(async (tx) => {
        await tx
          .select({ id: contactTargets.id })
          .from(contactTargets)
          .where(eq(contactTargets.id, targetId))
          .for('update');
        markTargetLocked();
        await targetRelease;
      });
      await targetLocked;

      const nextAcquire = db.transaction((tx) =>
        acquireTestTargetResponse(tx, {
          surveyId,
          contactTargetId: targetId,
          sessionId: 'next-session',
          attemptId: nextAttemptId,
          versionId: null,
          currentStepId: 'next-step',
        }),
      );
      await waitForDatabaseLock('contact_targets');
      const staleComplete = completeResponse({
        responseId,
        attemptId: staleAttemptId,
        sessionId: 'stale-session',
      });
      await waitForDatabaseLock('contact_targets', 2);
      releaseTarget();

      const [acquireResult, completeResult] = await Promise.allSettled([
        nextAcquire,
        staleComplete,
      ]);
      await blocker;
      expect(acquireResult.status).toBe('fulfilled');
      expect(completeResult).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({
          message: '테스트 세션이 다른 화면에서 시작되었습니다',
        }),
      });

      const state = await db.execute<{
        status: string;
        is_completed: boolean;
        session_id: string | null;
        response_id: string | null;
        responded_at: string | null;
      }>(sql`
        SELECT sr.status,sr.is_completed,sr.session_id,ct.response_id,ct.responded_at
        FROM survey_responses sr
        JOIN contact_targets ct ON ct.id=sr.contact_target_id
        WHERE sr.id=${responseId}
      `);
      expect(state[0]).toMatchObject({
        status: 'in_progress',
        is_completed: false,
        session_id: 'next-session',
        response_id: responseId,
        responded_at: null,
      });
    } finally {
      releaseTarget();
      await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
    }
  });
});

run('대상자 테스트 응답 재사용과 attempt 소유권', () => {
  const surveyId = randomUUID();
  const targetId = randomUUID();
  const concurrentTargetId = randomUUID();
  const responseId = randomUUID();
  const firstAttemptId = randomUUID();
  const secondAttemptId = randomUUID();

  beforeAll(async () => {
    await db.execute(
      sql`INSERT INTO surveys (id,title,test_mode_enabled) VALUES (${surveyId},'attempt-test',true)`,
    );
    await db.execute(sql`
      INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code,response_id,responded_at)
      VALUES (${targetId},${surveyId},1,true,${randomUUID()},null,now()),
             (${concurrentTargetId},${surveyId},2,true,${randomUUID()},null,null)
    `);
    await db.execute(sql`
      INSERT INTO survey_responses (
        id,survey_id,question_responses,is_test,contact_target_id,session_id,
        is_completed,status,completed_at,current_step_id,page_visits,total_seconds,
        progress_pct,visible_step_index,visible_step_total,metadata,last_edited_at
      ) VALUES (
        ${responseId},${surveyId},${JSON.stringify({ q1: 'old' })}::jsonb,true,${targetId},'old-session',
        true,'completed',now(),'old-step','[{"stepId":"old-step","enteredAt":"2026-07-21T00:00:00.000Z"}]'::jsonb,
        30,100,2,2,'{"exposedQuestionIds":["q1"]}'::jsonb,now()
      )
    `);
    await db.execute(sql`
      INSERT INTO response_answers (response_id,question_id,text_value,question_type)
      VALUES (${responseId},${randomUUID()},'old','text')
    `);
    await db.execute(sql`
      INSERT INTO response_edit_logs (response_id,survey_id,changed_questions,changed_count)
      VALUES (${responseId},${surveyId},'[]'::jsonb,1)
    `);
    await db.execute(
      sql`UPDATE contact_targets SET response_id=${responseId} WHERE id=${targetId}`,
    );
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
  });

  it('terminal 응답의 첫 입력은 같은 행을 초기화하고 정규화 답변과 수정 로그를 제거한다', async () => {
    const acquired = await db.transaction((tx) =>
      acquireTestTargetResponse(tx, {
        surveyId,
        contactTargetId: targetId,
        sessionId: 'first-session',
        attemptId: firstAttemptId,
        versionId: null,
        currentStepId: 'new-step',
        userAgent: 'test-agent',
        platform: 'desktop',
        browser: 'Chrome',
      }),
    );

    expect(acquired).toEqual({ responseId, reset: true });
    const rows = await db.execute<{
      id: string;
      question_responses: Record<string, unknown>;
      is_completed: boolean;
      status: string;
      completed_at: Date | null;
      current_step_id: string | null;
      page_visits: unknown[];
      total_seconds: number | null;
      progress_pct: number | null;
      visible_step_index: number | null;
      visible_step_total: number | null;
      metadata: unknown;
      last_edited_at: Date | null;
      session_id: string | null;
    }>(sql`SELECT * FROM survey_responses WHERE id=${responseId}`);
    expect(rows[0]).toMatchObject({
      id: responseId,
      question_responses: {},
      is_completed: false,
      status: 'in_progress',
      completed_at: null,
      current_step_id: 'new-step',
      page_visits: [],
      total_seconds: null,
      progress_pct: null,
      visible_step_index: null,
      visible_step_total: null,
      metadata: null,
      last_edited_at: null,
      session_id: 'first-session',
    });
    const childCounts = await db.execute<{ answers: number; logs: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM response_answers WHERE response_id=${responseId}) AS answers,
        (SELECT count(*)::int FROM response_edit_logs WHERE response_id=${responseId}) AS logs
    `);
    expect(childCounts[0]).toEqual({ answers: 0, logs: 0 });
  });

  it('더 늦게 입력을 시작한 attempt가 소유권을 인수하고 이전 attempt는 차단된다', async () => {
    await db.transaction((tx) =>
      acquireTestTargetResponse(tx, {
        surveyId,
        contactTargetId: targetId,
        sessionId: 'second-session',
        attemptId: secondAttemptId,
        versionId: null,
        currentStepId: 'new-step',
      }),
    );

    await expect(
      db.transaction((tx) =>
        assertTestTargetAttemptOwner(tx, {
          responseId,
          attemptId: firstAttemptId,
          sessionId: 'first-session',
        }),
      ),
    ).rejects.toThrow('테스트 세션이 다른 화면에서 시작되었습니다');
    await expect(
      db.transaction((tx) =>
        assertTestTargetAttemptOwner(tx, {
          responseId,
          attemptId: secondAttemptId,
          sessionId: 'second-session',
        }),
      ),
    ).resolves.toBeUndefined();

    await expect(
      recordStepVisit({
        responseId,
        nextStepId: 'stale-step',
        attemptId: firstAttemptId,
        sessionId: 'first-session',
      }),
    ).rejects.toThrow('테스트 세션이 다른 화면에서 시작되었습니다');
    await expect(
      recordVisibilitySegment({
        responseId,
        action: 'hide',
        attemptId: firstAttemptId,
        sessionId: 'first-session',
      }),
    ).rejects.toThrow('테스트 세션이 다른 화면에서 시작되었습니다');
    await expect(
      completeResponse({
        responseId,
        attemptId: firstAttemptId,
        sessionId: 'first-session',
      }),
    ).rejects.toThrow('테스트 세션이 다른 화면에서 시작되었습니다');

    await db.execute(sql`UPDATE surveys SET test_mode_enabled=false WHERE id=${surveyId}`);
    await expect(
      recordStepVisit({
        responseId,
        nextStepId: 'mode-off-step',
        attemptId: secondAttemptId,
        sessionId: 'second-session',
      }),
    ).rejects.toThrow('테스트 링크가 더 이상 유효하지 않습니다');
    await expect(
      completeResponse({
        responseId,
        attemptId: secondAttemptId,
        sessionId: 'second-session',
      }),
    ).rejects.toThrow('테스트 링크가 더 이상 유효하지 않습니다');
    await db.execute(sql`UPDATE surveys SET test_mode_enabled=true WHERE id=${surveyId}`);
  });

  it('응답이 없는 대상자의 동시 인수도 활성 응답 한 행과 active attempt 하나만 남긴다', async () => {
    const attemptA = randomUUID();
    const attemptB = randomUUID();
    await Promise.all([
      db.transaction((tx) =>
        acquireTestTargetResponse(tx, {
          surveyId,
          contactTargetId: concurrentTargetId,
          sessionId: 'concurrent-a',
          attemptId: attemptA,
          versionId: null,
          currentStepId: 'step-a',
        }),
      ),
      db.transaction((tx) =>
        acquireTestTargetResponse(tx, {
          surveyId,
          contactTargetId: concurrentTargetId,
          sessionId: 'concurrent-b',
          attemptId: attemptB,
          versionId: null,
          currentStepId: 'step-b',
        }),
      ),
    ]);

    const counts = await db.execute<{ responses: number; active_attempts: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM survey_responses
          WHERE contact_target_id=${concurrentTargetId} AND is_test=true AND deleted_at IS NULL) AS responses,
        (SELECT count(*)::int FROM test_response_attempts tra
          JOIN survey_responses sr ON sr.id=tra.response_id
          WHERE sr.contact_target_id=${concurrentTargetId} AND tra.status='active') AS active_attempts
    `);
    expect(counts[0]).toEqual({ responses: 1, active_attempts: 1 });
  });
});
