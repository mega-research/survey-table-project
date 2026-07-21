import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

run('조사대상자 테스트 모드 DB 제약', () => {
  const surveyId = randomUUID();
  const targetId = randomUUID();
  const responseId = randomUUID();

  beforeAll(async () => {
    await db.execute(
      sql`INSERT INTO surveys (id,title,test_mode_enabled) VALUES (${surveyId},'test',true)`,
    );
    await db.execute(
      sql`INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code) VALUES (${targetId},${surveyId},1,true,'testcode01')`,
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
});
