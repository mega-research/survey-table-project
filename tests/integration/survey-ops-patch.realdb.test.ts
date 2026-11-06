/**
 * 운영 설문 고치기 도우미(scripts/survey-ops/patch-core) — 실DB 왕복 계약.
 *
 * - 시험 실행은 되돌린다(문항·설문 updated_at 그대로)
 * - 없어지는 변수명이 있으면 --allow-var-changes 없이는 되돌린다
 * - --allow-var-changes · --commit 이면 커밋하고 설문 updated_at 을 올린다
 * - 아무것도 안 바꾼 패치는 「변경 없음」으로 되돌린다
 * - 패치 안에서 던진 오류는 되돌리고 그대로 올라온다
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요)
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { questions, surveys } from '@/db/schema';

import { executeSurveyPatch } from '../../scripts/survey-ops/patch-core';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];
const quiet = { log: () => {} };

async function seed() {
  const [survey] = await db
    .insert(surveys)
    .values({ title: '설문 고치기 도우미 테스트', updatedAt: new Date('2026-01-01T00:00:00Z') })
    .returning({ id: surveys.id });
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);
  const [q] = await db
    .insert(questions)
    .values({
      surveyId: survey.id,
      type: 'checkbox',
      title: '이용 경로',
      order: 1,
      questionCode: 'Q1',
      options: [
        { id: 'o1', label: '메일', value: '1' },
        { id: 'o2', label: '문자', value: '2' },
      ],
    })
    .returning({ id: questions.id });
  return { surveyId: survey.id, questionId: q!.id };
}

async function read(surveyId: string, questionId: string) {
  const [s] = await db
    .select({ updatedAt: surveys.updatedAt })
    .from(surveys)
    .where(eq(surveys.id, surveyId));
  const [q] = await db
    .select({ title: questions.title, options: questions.options })
    .from(questions)
    .where(eq(questions.id, questionId));
  return {
    surveyUpdatedAt: s!.updatedAt.toISOString(),
    title: q!.title,
    optionCount: (q!.options as unknown[]).length,
  };
}

afterAll(async () => {
  if (createdSurveyIds.length > 0) {
    await db.delete(questions).where(inArray(questions.surveyId, createdSurveyIds));
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  }
});

describe.skipIf(!isLocalDb)('executeSurveyPatch', () => {
  it('시험 실행은 되돌리고 바뀐 문항을 보고한다', async () => {
    const { surveyId, questionId } = await seed();
    const result = await executeSurveyPatch(
      db,
      {
        surveyId,
        title: '제목 바꾸기',
        apply: async ({ tx, schema, eq }) => {
          await tx
            .update(schema.questions)
            .set({ title: '바뀐 제목' })
            .where(eq(schema.questions.id, questionId));
        },
      },
      { commit: false, allowVarChanges: false, ...quiet },
    );
    expect(result.outcome).toBe('dry-run');
    expect(result.changedQuestionCodes).toEqual(['Q1']);
    expect(await read(surveyId, questionId)).toEqual({
      surveyUpdatedAt: '2026-01-01T00:00:00.000Z',
      title: '이용 경로',
      optionCount: 2,
    });
  });

  it('없어지는 변수명이 있으면 커밋을 붙여도 되돌린다', async () => {
    const { surveyId, questionId } = await seed();
    const dropOption = {
      surveyId,
      title: '보기 하나 지우기',
      apply: async ({
        tx,
        schema,
        eq,
      }: Parameters<Parameters<typeof executeSurveyPatch>[1]['apply']>[0]) => {
        await tx
          .update(schema.questions)
          .set({ options: [{ id: 'o1', label: '메일', value: '1' }] })
          .where(eq(schema.questions.id, questionId));
      },
    };
    const rejected = await executeSurveyPatch(db, dropOption, {
      commit: true,
      allowVarChanges: false,
      ...quiet,
    });
    expect(rejected.outcome).toBe('rejected-var-change');
    expect(rejected.diff.removed.map((v) => v.name)).toEqual(['Q1_2']);
    expect((await read(surveyId, questionId)).optionCount).toBe(2);

    const committed = await executeSurveyPatch(db, dropOption, {
      commit: true,
      allowVarChanges: true,
      ...quiet,
    });
    expect(committed.outcome).toBe('committed');
    const after = await read(surveyId, questionId);
    expect(after.optionCount).toBe(1);
    expect(after.surveyUpdatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('아무것도 바꾸지 않은 패치는 변경 없음으로 되돌린다', async () => {
    const { surveyId, questionId } = await seed();
    const result = await executeSurveyPatch(
      db,
      { surveyId, title: '아무것도 안 함', apply: async () => {} },
      { commit: true, allowVarChanges: false, ...quiet },
    );
    expect(result.outcome).toBe('no-change');
    expect((await read(surveyId, questionId)).surveyUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('패치 안의 오류는 되돌리고 그대로 올라온다', async () => {
    const { surveyId, questionId } = await seed();
    await expect(
      executeSurveyPatch(
        db,
        {
          surveyId,
          title: '중간 실패',
          apply: async ({ tx, schema, eq }) => {
            await tx
              .update(schema.questions)
              .set({ title: '반쯤' })
              .where(eq(schema.questions.id, questionId));
            throw new Error('원문이 다름');
          },
        },
        { commit: true, allowVarChanges: false, ...quiet },
      ),
    ).rejects.toThrow('원문이 다름');
    expect((await read(surveyId, questionId)).title).toBe('이용 경로');
  });

  it('없는 설문이면 거부한다', async () => {
    await expect(
      executeSurveyPatch(
        db,
        { surveyId: '00000000-0000-4000-8000-000000000000', title: 'x', apply: async () => {} },
        { commit: false, allowVarChanges: false, ...quiet },
      ),
    ).rejects.toThrow(/설문이 없습니다/);
  });
});
