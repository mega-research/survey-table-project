import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { prepareContactInsertScope } from '@/features/contacts/server/services/contact-insert-scope.service';
import {
  recordStepVisit,
  recordVisibilitySegment,
} from '@/features/survey-response/server/services/lifecycle.service';
import { completeResponse } from '@/features/survey-response/server/services/response.service';
import {
  acquireTestTargetResponse,
  assertAnonymousTestSession,
  assertTestTargetAttemptOwner,
} from '@/lib/survey-response/test-target-attempt.server';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

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
