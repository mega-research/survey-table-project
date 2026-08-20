/**
 * draft seq 동시성 가드 실 DB integration test.
 *
 * claimDraftSeq(선점)와 답변 UPDATE 는 별개 문장이라, 그 사이에 더 큰 seq 가 선점·적용되면
 * (지연된 oRPC draft 와 pagehide beacon 의 역순 완료) 낡은 답변이 최신을 덮을 수 있었다.
 * 답변 UPDATE 의 WHERE 에 metadata.draftSeq = 요청 seq 조건을 걸어 0행이면 stale 로
 * 처리한다 — 이 테스트는 "선점은 했지만 적용 전에 추월당한" 상태를 metadata 직접 갱신으로
 * 재현해 가드를 고정한다.
 * 실행 조건: DATABASE_URL 이 로컬일 때만. 선행: pnpm db:setup-test.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { questions, surveyResponses, surveys } from '@/db/schema';
import {
  applyDraftAnswersUpdate,
  saveDraftResponse,
} from '@/features/survey-response/server/services/response.service';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

describe.skipIf(!isLocalDb)('draft seq 동시성 가드 (real local DB)', () => {
  const createdSurveyIds: string[] = [];

  afterAll(async () => {
    for (const id of createdSurveyIds) {
      await db.delete(surveyResponses).where(eq(surveyResponses.surveyId, id));
      await db.delete(questions).where(eq(questions.surveyId, id));
      await db.delete(surveys).where(eq(surveys.id, id));
    }
  });

  async function seedResponse() {
    const [survey] = await db
      .insert(surveys)
      .values({ title: 'draft-seq-가드', isPublic: true })
      .returning({ id: surveys.id });
    if (!survey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(survey.id);

    // saveDraftResponse 의 소속 검증이 questions 를 UUID 로 조회한다 — 실제 질문 행 필요
    const [question] = await db
      .insert(questions)
      .values({ surveyId: survey.id, type: 'text', title: 'Q', required: false, order: 0 })
      .returning({ id: questions.id });
    if (!question) throw new Error('question 삽입 실패');

    const [response] = await db
      .insert(surveyResponses)
      .values({
        surveyId: survey.id,
        sessionId: `seq-guard-${Math.floor(Math.random() * 1e9)}`,
        questionResponses: { [question.id]: '최신값' },
        isCompleted: false,
        status: 'in_progress',
      })
      .returning({ id: surveyResponses.id });
    if (!response) throw new Error('response 삽입 실패');
    return { responseId: response.id, questionId: question.id };
  }

  it('선점 이후 더 큰 seq 가 끼어들면 낡은 답변을 쓰지 않고 stale 을 돌려준다', async () => {
    const { responseId, questionId } = await seedResponse();
    // 재현: 이 요청(seq=1)이 claim 을 마친 사이, 다른 요청(seq=2)이 선점+적용까지 끝난 상태
    await db.execute(sql`
      UPDATE survey_responses
      SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), ARRAY['draftSeq'], '2', true)
      WHERE id = ${responseId}
    `);

    const outcome = await applyDraftAnswersUpdate(db, responseId, [questionId], { [questionId]: '낡은값' }, 1);
    expect(outcome).toBe('stale');

    const [row] = await db
      .select({ questionResponses: surveyResponses.questionResponses })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId));
    expect((row?.questionResponses as Record<string, unknown>)[questionId]).toBe('최신값');
  });

  it('자기 seq 가 그대로면 정상 적용된다', async () => {
    const { responseId, questionId } = await seedResponse();
    await db.execute(sql`
      UPDATE survey_responses
      SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), ARRAY['draftSeq'], '3', true)
      WHERE id = ${responseId}
    `);

    const outcome = await applyDraftAnswersUpdate(db, responseId, [questionId], { [questionId]: '새값' }, 3);
    expect(outcome).toBe('applied');

    const [row] = await db
      .select({ questionResponses: surveyResponses.questionResponses })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId));
    expect((row?.questionResponses as Record<string, unknown>)[questionId]).toBe('새값');
  });

  it('saveDraftResponse 왕복 — 사다리 정상 적용과 stale 거부가 그대로 동작한다', async () => {
    const { responseId, questionId } = await seedResponse();

    await expect(
      saveDraftResponse({ responseId, answers: { [questionId]: 'v-seq2' }, seq: 2 }),
    ).resolves.toEqual({ applied: true });
    await expect(
      saveDraftResponse({ responseId, answers: { [questionId]: 'v-seq1-late' }, seq: 1 }),
    ).resolves.toEqual({ applied: false });

    const [row] = await db
      .select({ questionResponses: surveyResponses.questionResponses })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId));
    expect((row?.questionResponses as Record<string, unknown>)[questionId]).toBe('v-seq2');
  });
});
