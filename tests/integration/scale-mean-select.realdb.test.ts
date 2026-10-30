/**
 * 척도 평균 「문항 선택」 저장 — 실DB 왕복 계약 테스트 (CONTEXT.md 「척도 평균」).
 *
 * 계약:
 * - 고른 문항만 켜고 같은 설문의 나머지는 끈다. 다른 설문은 건드리지 않는다
 * - 후보 밖 문항이 섞이면 아무것도 바꾸지 않는다
 * - 문항 updated_at 을 건드리지 않는다
 * - 저장 결과가 곧바로 화면 읽기(getScaleMeanView)에 보인다
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요)
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { questions, surveys } from '@/db/schema';
import { getScaleMeanView, setScaleMeanQuestions } from '@/server/operations/services/scale-mean';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];

const SEVEN = ['1', '2', '3', '4', '5', '6', '7'].map((v) => ({ id: `o${v}`, label: v, value: v }));

async function seed(): Promise<{ surveyId: string; q1: string; q2: string; text: string }> {
  const [survey] = await db
    .insert(surveys)
    .values({ title: '척도 평균 문항 선택 테스트' })
    .returning({ id: surveys.id });
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);
  const rows = await db
    .insert(questions)
    .values([
      {
        surveyId: survey.id,
        type: 'radio',
        title: 'Q1. 만족',
        order: 1,
        questionCode: 'Q1',
        options: SEVEN,
        scaleMeanEnabled: true,
      },
      {
        surveyId: survey.id,
        type: 'radio',
        title: 'Q2. 만족',
        order: 2,
        questionCode: 'Q2',
        options: SEVEN,
      },
      { surveyId: survey.id, type: 'text', title: '이름', order: 3, questionCode: 'Q3' },
    ])
    .returning({ id: questions.id, order: questions.order });
  const byOrder = new Map(rows.map((r) => [r.order, r.id]));
  return { surveyId: survey.id, q1: byOrder.get(1)!, q2: byOrder.get(2)!, text: byOrder.get(3)! };
}

async function enabledOf(ids: string[]) {
  const rows = await db
    .select({ id: questions.id, on: questions.scaleMeanEnabled, updatedAt: questions.updatedAt })
    .from(questions)
    .where(inArray(questions.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

afterAll(async () => {
  if (createdSurveyIds.length > 0) {
    await db.delete(questions).where(inArray(questions.surveyId, createdSurveyIds));
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  }
});

describe.skipIf(!isLocalDb)('setScaleMeanQuestions — 문항 선택 저장', () => {
  it('고른 문항만 켜고 나머지는 끄며 다른 설문과 updated_at 은 그대로다', async () => {
    const a = await seed();
    const other = await seed();
    const before = await enabledOf([a.q1, a.q2]);

    await expect(
      setScaleMeanQuestions({ surveyId: a.surveyId, questionIds: [a.q2] }),
    ).resolves.toEqual({ ok: true });

    const after = await enabledOf([a.q1, a.q2, other.q1]);
    expect(after.get(a.q1)?.on).toBe(false);
    expect(after.get(a.q2)?.on).toBe(true);
    expect(after.get(other.q1)?.on).toBe(true);
    expect(after.get(a.q1)?.updatedAt.getTime()).toBe(before.get(a.q1)?.updatedAt.getTime());

    // 같은 요청을 다시 보내도 결과가 같다
    await setScaleMeanQuestions({ surveyId: a.surveyId, questionIds: [a.q2] });
    expect((await enabledOf([a.q2])).get(a.q2)?.on).toBe(true);

    const view = await getScaleMeanView(a.surveyId, 'real');
    expect(view.candidates.map((c) => [c.code, c.enabled])).toEqual([
      ['Q1', false],
      ['Q2', true],
    ]);
    expect(view.summary.rows.map((r) => r.varName)).toEqual(['Q2']);
  });

  it('빈 목록이면 전부 끈다', async () => {
    const a = await seed();
    await expect(setScaleMeanQuestions({ surveyId: a.surveyId, questionIds: [] })).resolves.toEqual(
      { ok: true },
    );
    expect((await enabledOf([a.q1])).get(a.q1)?.on).toBe(false);
  });

  it('후보 밖 문항이 섞이면 거부하고 아무것도 바꾸지 않는다', async () => {
    const a = await seed();
    const other = await seed();
    for (const ids of [
      [a.q2, a.text],
      [a.q2, other.q2],
    ]) {
      const result = await setScaleMeanQuestions({ surveyId: a.surveyId, questionIds: ids });
      expect(result.ok).toBe(false);
    }
    const after = await enabledOf([a.q1, a.q2, other.q2]);
    expect(after.get(a.q1)?.on).toBe(true);
    expect(after.get(a.q2)?.on).toBe(false);
    expect(after.get(other.q2)?.on).toBe(false);
  });

  it('지운 설문이면 거부한다', async () => {
    const a = await seed();
    await db.update(surveys).set({ deletedAt: new Date() }).where(eq(surveys.id, a.surveyId));
    await expect(setScaleMeanQuestions({ surveyId: a.surveyId, questionIds: [] })).resolves.toEqual(
      {
        ok: false,
        error: '설문을 찾을 수 없습니다.',
      },
    );
    expect((await enabledOf([a.q1])).get(a.q1)?.on).toBe(true);
  });
});
