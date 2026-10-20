/**
 * 중도 이탈(drop) 행의 쓰기 — 실DB 왕복 계약 테스트.
 *
 * sweep_stale_sessions 는 3시간 활동이 없는 in_progress 행을 drop 으로 바꾼다. 탭을 열어 둔 채
 * 자리를 비운 응답자는 페이지를 다시 불러오지 않고 그대로 「다음」·「제출」을 누른다.
 * drop 은 종결이 아니라 열린 상태다(shared/contracts/survey-response 의 openResponseStatusValues).
 *
 * 계약:
 * - drop 행의 draft 는 답을 저장하고 행을 in_progress 로 되살린다 — "이미 완료" 로 접지 않는다
 * - drop 행의 complete 는 답을 저장하고 완료로 확정한다 — alreadyCompleted 로 흡수하지 않는다
 * - draft 는 활동 시각을 올려 입력 중인 행이 sweep 에 걸리지 않게 한다
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요)
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { questions, surveyResponses, surveys, surveyVersions } from '@/db/schema';
import { completeResponse } from '@/server/survey-response/services/response-completion';
import {
  saveDraftResponse,
  saveDraftResponseIfActive,
} from '@/server/survey-response/services/response-draft';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];

function buildSnapshot(questionId: string): SurveyVersionSnapshot {
  return {
    title: 'drop 되살리기',
    description: '',
    groups: [],
    settings: {
      isPublic: true,
      allowMultipleResponses: false,
      showProgressBar: false,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '',
    },
    questions: [{ id: questionId, type: 'text', title: '이름', required: false, order: 0 }],
  };
}

/** 4시간 전에 마지막으로 움직이고 sweep 에 걸린 응답 행 — sweep_stale_sessions 와 같은 모양으로 만든다 */
async function seedDroppedResponse() {
  const [survey] = await db
    .insert(surveys)
    .values({ title: 'drop 되살리기', status: 'published', isPublic: true })
    .returning({ id: surveys.id });
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);

  const [question] = await db
    .insert(questions)
    .values({ surveyId: survey.id, type: 'text', title: '이름', required: false, order: 0 })
    .returning({ id: questions.id });
  if (!question) throw new Error('문항 시드 실패');

  const [version] = await db
    .insert(surveyVersions)
    .values({
      surveyId: survey.id,
      versionNumber: 1,
      status: 'published',
      snapshot: buildSnapshot(question.id),
      publishedAt: new Date(),
    })
    .returning({ id: surveyVersions.id });
  if (!version) throw new Error('버전 시드 실패');
  await db.update(surveys).set({ currentVersionId: version.id }).where(eq(surveys.id, survey.id));

  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const [response] = await db
    .insert(surveyResponses)
    .values({
      surveyId: survey.id,
      versionId: version.id,
      sessionId: `drop-${crypto.randomUUID()}`,
      status: 'in_progress',
      isCompleted: false,
      questionResponses: {},
      lastActivityAt: fourHoursAgo,
    })
    .returning({ id: surveyResponses.id });
  if (!response) throw new Error('응답 시드 실패');

  // sweep_stale_sessions 본문과 같은 전이 (0029) — 공용 DB 의 다른 행을 건드리지 않으려 함수 대신 직접 쓴다
  await db.execute(sql`
    UPDATE survey_responses
    SET status = 'drop', completed_at = last_activity_at
    WHERE id = ${response.id}
  `);

  return { responseId: response.id, questionId: question.id, fourHoursAgo };
}

async function readRow(responseId: string) {
  const [row] = await db
    .select({
      status: surveyResponses.status,
      isCompleted: surveyResponses.isCompleted,
      questionResponses: surveyResponses.questionResponses,
      lastActivityAt: surveyResponses.lastActivityAt,
    })
    .from(surveyResponses)
    .where(eq(surveyResponses.id, responseId));
  if (!row) throw new Error('응답 행 없음');
  return row;
}

describe.skipIf(!isLocalDb)('중도 이탈(drop) 행의 쓰기 실DB 왕복', () => {
  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      await db.delete(surveyResponses).where(inArray(surveyResponses.surveyId, createdSurveyIds));
      await db.update(surveys).set({ currentVersionId: null }).where(inArray(surveys.id, createdSurveyIds));
      await db.delete(surveyVersions).where(inArray(surveyVersions.surveyId, createdSurveyIds));
      await db.delete(questions).where(inArray(questions.surveyId, createdSurveyIds));
      await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
    }
  });

  it('drop 행의 draft 는 답을 저장하고 진행 중으로 되살린다', async () => {
    const { responseId, questionId } = await seedDroppedResponse();

    await expect(
      saveDraftResponse({ responseId, answers: { [questionId]: '홍길동' }, seq: 1 }),
    ).resolves.toEqual({ applied: true });

    const row = await readRow(responseId);
    expect(row.status).toBe('in_progress');
    expect((row.questionResponses as Record<string, unknown>)[questionId]).toBe('홍길동');
  });

  it('drop 행의 이탈 beacon draft 도 건너뛰지 않고 저장한다', async () => {
    const { responseId, questionId } = await seedDroppedResponse();

    await expect(
      saveDraftResponseIfActive({ responseId, answers: { [questionId]: '홍길동' }, seq: 1 }),
    ).resolves.toEqual({ saved: true });

    const row = await readRow(responseId);
    expect(row.status).toBe('in_progress');
    expect((row.questionResponses as Record<string, unknown>)[questionId]).toBe('홍길동');
  });

  it('drop 행의 complete 는 답을 저장하고 완료로 확정한다', async () => {
    const { responseId, questionId } = await seedDroppedResponse();

    const result = await completeResponse({
      responseId,
      data: { questionResponses: { [questionId]: '홍길동' } },
    });
    expect(result).not.toMatchObject({ alreadyCompleted: true });

    const row = await readRow(responseId);
    expect(row.status).toBe('completed');
    expect(row.isCompleted).toBe(true);
    expect((row.questionResponses as Record<string, unknown>)[questionId]).toBe('홍길동');
  });

  it('draft 는 활동 시각을 올려 입력 중인 행이 sweep 에 걸리지 않게 한다', async () => {
    const { responseId, questionId, fourHoursAgo } = await seedDroppedResponse();
    // 진행 중 행 — sweep 직전 상태
    await db
      .update(surveyResponses)
      .set({ status: 'in_progress', lastActivityAt: fourHoursAgo })
      .where(eq(surveyResponses.id, responseId));

    await saveDraftResponse({ responseId, answers: { [questionId]: '홍길동' }, seq: 1 });

    const row = await readRow(responseId);
    expect(row.lastActivityAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
