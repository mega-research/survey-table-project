import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { responseAnswers, surveyResponses, surveys } from '@/db/schema';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

const MARKER = '[개인정보 파기됨]';

/**
 * sweep_expired_pii() — 표 input 셀 단위 암호문(한 단계 중첩 객체)도 파기하는지.
 * 0050 은 최상위 string 만 봤다 (질문 단위 PII). 셀 단위 암호화(0085)는 question_responses 의
 * 객체 값 안과 response_answers.object_value 안에 암호문을 두므로 둘 다 파기 대상이어야 한다.
 */
run('sweep_expired_pii — 표 셀 암호문 파기', () => {
  const surveyIds: string[] = [];

  afterAll(async () => {
    for (const id of surveyIds) await db.delete(surveys).where(eq(surveys.id, id));
  });

  it('보관기한 경과 설문의 최상위·셀 안 암호문을 마커로 치환하고 평문 셀·배열은 보존한다', async () => {
    const surveyId = randomUUID();
    surveyIds.push(surveyId);
    await db.insert(surveys).values({
      id: surveyId,
      title: '파기 테스트',
      piiRetentionUntil: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const responseId = randomUUID();
    const tableQid = randomUUID();
    await db.insert(surveyResponses).values({
      id: responseId,
      surveyId,
      questionResponses: {
        q1: 'v1:top-level-cipher',
        [tableQid]: { c1: 'v1:cell-cipher', c2: '서울', c3: ['a', 'b'] },
        q3: '평문 답변',
      },
    });
    await db.insert(responseAnswers).values({
      responseId,
      questionId: tableQid,
      questionType: 'table',
      objectValue: { c1: 'v1:cell-cipher', c2: '서울' },
    });

    await db.execute(sql`SELECT sweep_expired_pii()`);

    const [row] = await db
      .select({ questionResponses: surveyResponses.questionResponses })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId));
    expect(row?.questionResponses).toEqual({
      q1: MARKER,
      [tableQid]: { c1: MARKER, c2: '서울', c3: ['a', 'b'] },
      q3: '평문 답변',
    });

    const [answer] = await db
      .select({ objectValue: responseAnswers.objectValue })
      .from(responseAnswers)
      .where(eq(responseAnswers.responseId, responseId));
    expect(answer?.objectValue).toEqual({ c1: MARKER, c2: '서울' });

    // 멱등 — 재실행해도 변화 없음 (마커는 접두사에 매치되지 않는다)
    await db.execute(sql`SELECT sweep_expired_pii()`);
    const [again] = await db
      .select({ questionResponses: surveyResponses.questionResponses })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId));
    expect(again?.questionResponses).toEqual(row?.questionResponses);
  });
});
