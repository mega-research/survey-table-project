/**
 * 자격미달 종료 저장 — 실DB 왕복 계약 테스트.
 *
 * 계약:
 * - endOutcome 이 screened_out 인 end 분기가 트리거되면 status='screened_out', is_completed=false
 * - endOutcome 미지정 end 분기는 기존대로 status='completed', is_completed=true
 * - 클라이언트가 무엇을 보내든 판정 권한은 서버의 스냅샷 재평가에 있다
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요)
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { surveys, surveyVersions, surveyResponses } from '@/db/schema';
import { completeResponse } from '@/features/survey-response/server/services/response.service';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];

function buildSnapshot(endOutcome?: 'completed' | 'screened_out') {
  return {
    title: '자격미달 테스트',
    description: '',
    settings: {},
    lookups: [],
    groups: [],
    questions: [
      {
        id: 'q-screen',
        surveyId: 'seed',
        type: 'radio',
        title: '학년',
        required: true,
        order: 0,
        options: [
          {
            id: 'opt-low',
            label: '1학년',
            value: 'option-1',
            branchRule: {
              id: 'br-1',
              value: '',
              action: 'end',
              ...(endOutcome ? { endOutcome } : {}),
            },
          },
          { id: 'opt-grad', label: '졸업자', value: 'option-5' },
        ],
      },
    ],
  };
}

async function seed(endOutcome?: 'completed' | 'screened_out') {
  const [survey] = await db
    .insert(surveys)
    .values({ title: '자격미달 왕복 테스트', status: 'published' })
    .returning();
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);

  const [version] = await db
    .insert(surveyVersions)
    .values({
      surveyId: survey.id,
      versionNumber: 1,
      status: 'published',
      snapshot: buildSnapshot(endOutcome),
      publishedAt: new Date(),
    })
    .returning();
  if (!version) throw new Error('버전 시드 실패');

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

  return { surveyId: survey.id, responseId: response.id };
}

describe.skipIf(!isLocalDb)('자격미달 종료 저장 실DB 왕복', () => {
  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      await db.delete(surveyResponses).where(inArray(surveyResponses.surveyId, createdSurveyIds));
      await db.delete(surveyVersions).where(inArray(surveyVersions.surveyId, createdSurveyIds));
      await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
    }
  });

  it('endOutcome=screened_out 분기로 끝나면 자격미달로 저장된다', async () => {
    const { responseId } = await seed('screened_out');

    await completeResponse({
      responseId,
      data: { questionResponses: { 'q-screen': 'option-1' } },
    });

    const [row] = await db
      .select({ status: surveyResponses.status, isCompleted: surveyResponses.isCompleted })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId));

    expect(row?.status).toBe('screened_out');
    expect(row?.isCompleted).toBe(false);
  });

  it('endOutcome 미지정 end 분기는 기존대로 완료로 저장된다', async () => {
    const { responseId } = await seed();

    await completeResponse({
      responseId,
      data: { questionResponses: { 'q-screen': 'option-1' } },
    });

    const [row] = await db
      .select({ status: surveyResponses.status, isCompleted: surveyResponses.isCompleted })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId));

    expect(row?.status).toBe('completed');
    expect(row?.isCompleted).toBe(true);
  });

  it('자격미달 분기가 있어도 다른 선택지를 고르면 완료로 저장된다', async () => {
    const { responseId } = await seed('screened_out');

    await completeResponse({
      responseId,
      data: { questionResponses: { 'q-screen': 'option-5' } },
    });

    const [row] = await db
      .select({ status: surveyResponses.status, isCompleted: surveyResponses.isCompleted })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId));

    expect(row?.status).toBe('completed');
    expect(row?.isCompleted).toBe(true);
  });

  it('이미 자격미달로 종결된 행에 complete 를 재호출해도 에러 없이 흡수된다', async () => {
    const { responseId } = await seed('screened_out');

    await completeResponse({
      responseId,
      data: { questionResponses: { 'q-screen': 'option-1' } },
    });

    // 늦은/재시도 complete 흉내 — 정상 제출 후 네트워크 응답 유실로 인한 재시도와 동일한 모양.
    // status 가 이미 'screened_out' 이라 가드 UPDATE 는 0행이지만, 복구 분기가 종결 상태로
    // 판정해 throw 대신 멱등 흡수해야 한다(리뷰 지적 1). throw 하지 않고 반환되는 것 자체가
    // 이 케이스의 핵심 단언이다.
    await completeResponse({ responseId });

    const [row] = await db
      .select({ status: surveyResponses.status, isCompleted: surveyResponses.isCompleted })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId));

    expect(row?.status).toBe('screened_out');
    expect(row?.isCompleted).toBe(false);
  });

  it('data 없는 빈 complete 도 저장된 답변 기준으로 자격미달을 판정한다', async () => {
    const { responseId } = await seed('screened_out');

    // draft 저장 경로를 흉내낸다 — 자격미달 옵션이 이미 question_responses 에 저장된 상태.
    await db
      .update(surveyResponses)
      .set({ questionResponses: { 'q-screen': 'option-1' } })
      .where(eq(surveyResponses.id, responseId));

    // 클라이언트가 data 없이 complete 를 호출해도(계약상 optional) 서버가 저장된 값을
    // 재평가해야 한다 — 그렇지 않으면 자격미달 답변이 판정 없이 completed 로 새어나간다
    // (리뷰 지적 2).
    await completeResponse({ responseId });

    const [row] = await db
      .select({ status: surveyResponses.status, isCompleted: surveyResponses.isCompleted })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId));

    expect(row?.status).toBe('screened_out');
    expect(row?.isCompleted).toBe(false);
  });
});
