/**
 * 조각 좌우 반전 · 조각 한 화면 칸 수(`questions.mobile_drilldown_reverse_columns` ·
 * `mobile_drilldown_columns_per_view`, 0174) — 실 DB 왕복.
 *
 * 값이 빌더 저장 → DB → 빌더 로드 → 발행 스냅샷 → 복제 → 보관함을 도는 동안 한 곳이라도 빠지면 아무 오류
 * 없이 설정이 꺼진다. 단위 테스트는 매퍼·스냅샷·스키마를 따로 보므로, 여기서 procedure → service →
 * PostgreSQL 을 실제로 왕복시켜 이음매를 본다. CHECK 제약(범위 밖 거부)도 실 DB 에서만 확인된다.
 *
 * 실행: 전용 DB 에서만 — `pnpm db:isolated <이름>` 이 출력한 URL 로
 *   RUN_REALDB=1 DATABASE_URL=<URL> pnpm exec vitest run tests/integration/question-mobile-piece-arrangement.realdb.test.ts
 *
 * R2 회피: 이미지·첨부가 없는 평문 문항만 쓴다.
 */

import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  questions as questionsTable,
  savedQuestions as savedQuestionsTable,
  surveyVersions as surveyVersionsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import { savedQuestions } from '@/server/library/procedures/saved-questions';
import { publish } from '@/server/survey-builder/procedures/publish';
import { questions } from '@/server/survey-builder/procedures/questions';
import { read } from '@/server/survey-builder/procedures/read';
import { save } from '@/server/survey-builder/procedures/save';
import { surveys } from '@/server/survey-builder/procedures/surveys';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

// 역할 모델 v2: 생성은 팀 범위를, 저장·발행은 capability 를 요구하므로 실사용자·팀·멤버십 픽스처가 있어야 한다.
const ACTOR_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();
const ACTOR_EMAIL = `mobile-piece-${ACTOR_ID}@example.com`;

function authedContext(): ORPCContext {
  return {
    db,
    user: {
      id: ACTOR_ID,
      email: ACTOR_EMAIL,
      name: '테스트관리자',
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
    },
  };
}

function scaleQuestion(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'radio',
    title: '전반 만족도',
    required: true,
    order: 1,
    options: [
      { id: 'o1', label: '전혀 만족하지 않음', value: '1' },
      { id: 'o2', label: '보통', value: '2' },
      { id: 'o3', label: '매우 만족함', value: '3' },
    ],
    ...extra,
  };
}

const ON = { mobileDrilldownReverseColumns: true, mobileDrilldownColumnsPerView: 6 };

describe.skipIf(!isLocalDb)('조각 표현 설정 — 실 DB 왕복', () => {
  const client = createRouterClient(
    { surveys, save, publish, questions, read, savedQuestions },
    { context: authedContext() },
  );
  const createdSurveyIds: string[] = [];
  const createdSavedIds: string[] = [];

  beforeAll(async () => {
    await db.insert(usersTable).values({
      id: ACTOR_ID,
      name: '테스트관리자',
      email: ACTOR_EMAIL,
      emailVerified: true,
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
    });
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `문항칸팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembersTable).values({ teamId: TEAM_ID, userId: ACTOR_ID, role: 'member' });
  });

  afterAll(async () => {
    for (const id of createdSurveyIds) {
      await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
    for (const id of createdSavedIds) {
      await db.delete(savedQuestionsTable).where(eq(savedQuestionsTable.id, id));
    }
    await db.delete(teamMembersTable).where(eq(teamMembersTable.userId, ACTOR_ID));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(eq(usersTable.id, ACTOR_ID));
  });

  async function newSurvey(title: string): Promise<string> {
    const created = await client.surveys.create({ title });
    createdSurveyIds.push(created.id);
    return created.id;
  }

  async function saveQuestion(surveyId: string, question: Record<string, unknown>) {
    await client.save.saveDiff({
      surveyId,
      questionChanges: { upserted: [question] as never, deleted: [] },
    });
  }

  async function stored(questionId: string) {
    const [row] = await db
      .select({
        reverse: questionsTable.mobileDrilldownReverseColumns,
        perView: questionsTable.mobileDrilldownColumnsPerView,
      })
      .from(questionsTable)
      .where(eq(questionsTable.id, questionId));
    return row;
  }

  async function loadedQuestion(surveyId: string, questionId: string) {
    const loaded = await client.read.withDetails({ surveyId });
    const question = loaded?.questions.find((q) => q.id === questionId);
    if (!question) throw new Error('저장한 문항이 로드 결과에 없다');
    return question;
  }

  it('빌더 저장 → 로드: 두 값이 컬럼에 들어가고 그대로 읽힌다', async () => {
    const surveyId = await newSurvey('조각-왕복');
    const questionId = crypto.randomUUID();

    await saveQuestion(surveyId, scaleQuestion(questionId, ON));

    expect(await stored(questionId)).toEqual({ reverse: true, perView: 6 });
    const loaded = await loadedQuestion(surveyId, questionId);
    expect(loaded.mobileDrilldownReverseColumns).toBe(true);
    expect(loaded.mobileDrilldownColumnsPerView).toBe(6);
  });

  it('값이 없는 문항은 false · NULL 로 저장되고 로드 결과에 키가 없다', async () => {
    const surveyId = await newSurvey('조각-없음');
    const questionId = crypto.randomUUID();

    await saveQuestion(surveyId, scaleQuestion(questionId));

    expect(await stored(questionId)).toEqual({ reverse: false, perView: null });
    const loaded = await loadedQuestion(surveyId, questionId);
    expect('mobileDrilldownReverseColumns' in loaded).toBe(false);
    expect('mobileDrilldownColumnsPerView' in loaded).toBe(false);
  });

  it('빌더 저장에서 값을 지우면 꺼진다 — 싣지 않은 것과 false·null 둘 다', async () => {
    const surveyId = await newSurvey('조각-지우기');
    const questionId = crypto.randomUUID();

    await saveQuestion(surveyId, scaleQuestion(questionId, ON));
    await saveQuestion(surveyId, scaleQuestion(questionId));
    expect(await stored(questionId)).toEqual({ reverse: false, perView: null });

    await saveQuestion(surveyId, scaleQuestion(questionId, ON));
    await saveQuestion(
      surveyId,
      scaleQuestion(questionId, {
        mobileDrilldownReverseColumns: false,
        mobileDrilldownColumnsPerView: null,
      }),
    );
    expect(await stored(questionId)).toEqual({ reverse: false, perView: null });
  });

  it('문항 생성·수정: 값을 싣고, 다른 필드만 고치면 그대로 두고, false·null 로 끈다', async () => {
    const surveyId = await newSurvey('조각-문항-수정');
    const questionId = crypto.randomUUID();

    await client.questions.create({
      surveyId,
      id: questionId,
      type: 'radio',
      title: '전반 만족도',
      ...ON,
    });
    expect(await stored(questionId)).toEqual({ reverse: true, perView: 6 });

    await client.questions.update({ questionId, surveyId, data: { title: '제목만 고침' } });
    expect(await stored(questionId)).toEqual({ reverse: true, perView: 6 });

    await client.questions.update({
      questionId,
      surveyId,
      data: { mobileDrilldownColumnsPerView: null },
    });
    expect(await stored(questionId)).toEqual({ reverse: true, perView: null });

    await client.questions.update({
      questionId,
      surveyId,
      data: { mobileDrilldownReverseColumns: false },
    });
    expect(await stored(questionId)).toEqual({ reverse: false, perView: null });
  });

  it('범위 밖 칸 수는 저장에서 거부된다 — 입력 검증, 그리고 직접 INSERT 는 CHECK', async () => {
    const surveyId = await newSurvey('조각-범위-밖');
    const questionId = crypto.randomUUID();
    await saveQuestion(surveyId, scaleQuestion(questionId, ON));

    await expect(
      client.questions.update({
        questionId,
        surveyId,
        data: { mobileDrilldownColumnsPerView: 7 },
      }),
    ).rejects.toThrow();

    await expect(
      saveQuestion(surveyId, scaleQuestion(questionId, { mobileDrilldownColumnsPerView: 2 })),
    ).rejects.toThrow();

    const insertOutOfRange = db.insert(questionsTable).values({
      id: crypto.randomUUID(),
      surveyId,
      type: 'radio',
      title: 'CHECK 확인',
      order: 2,
      mobileDrilldownColumnsPerView: 7,
    });
    await expect(insertOutOfRange).rejects.toMatchObject({
      cause: {
        code: '23514',
        constraint_name: 'questions_mobile_drilldown_columns_per_view_check',
      },
    });

    // 거부된 저장은 있던 값을 건드리지 않는다
    expect(await stored(questionId)).toEqual({ reverse: true, perView: 6 });
  });

  it('발행 스냅샷: 켠 문항은 두 값이 얼고, 꺼진 문항에는 키가 없다', async () => {
    const surveyId = await newSurvey('조각-발행');
    const onId = crypto.randomUUID();
    const offId = crypto.randomUUID();
    await client.save.saveDiff({
      surveyId,
      questionChanges: {
        upserted: [
          scaleQuestion(onId, { ...ON, order: 1 }),
          scaleQuestion(offId, { order: 2 }),
        ] as never,
        deleted: [],
      },
    });

    const version = await client.publish.publish({ surveyId, changeNote: '조각 표현 설정' });
    const [row] = await db
      .select({ snapshot: surveyVersionsTable.snapshot })
      .from(surveyVersionsTable)
      .where(eq(surveyVersionsTable.id, version.id));
    const frozen = (row?.snapshot?.questions ?? []) as unknown as Record<string, unknown>[];

    const on = frozen.find((q) => q['id'] === onId);
    expect(on?.['mobileDrilldownReverseColumns']).toBe(true);
    expect(on?.['mobileDrilldownColumnsPerView']).toBe(6);
    const off = frozen.find((q) => q['id'] === offId);
    expect(off).toBeDefined();
    expect('mobileDrilldownReverseColumns' in off!).toBe(false);
    expect('mobileDrilldownColumnsPerView' in off!).toBe(false);
  });

  it('설문 복제: 두 값이 따라오고 꺼진 문항은 꺼진 채다', async () => {
    const surveyId = await newSurvey('조각-복제-원본');
    await client.save.saveDiff({
      surveyId,
      questionChanges: {
        upserted: [
          scaleQuestion(crypto.randomUUID(), { ...ON, order: 1 }),
          scaleQuestion(crypto.randomUUID(), { order: 2 }),
        ] as never,
        deleted: [],
      },
    });

    const copy = await client.surveys.duplicate({ surveyId });
    if (!copy) throw new Error('duplicate 가 null 을 반환했다');
    createdSurveyIds.push(copy.id);

    const copied = await db
      .select({
        order: questionsTable.order,
        reverse: questionsTable.mobileDrilldownReverseColumns,
        perView: questionsTable.mobileDrilldownColumnsPerView,
      })
      .from(questionsTable)
      .where(eq(questionsTable.surveyId, copy.id));
    const byOrder = new Map(copied.map((q) => [q.order, q]));

    expect(byOrder.get(1)).toMatchObject({ reverse: true, perView: 6 });
    expect(byOrder.get(2)).toMatchObject({ reverse: false, perView: null });
  });

  it('보관함: 넣었다 꺼내도 두 값이 따라온다', async () => {
    const surveyId = await newSurvey('조각-보관함');
    const questionId = crypto.randomUUID();
    await saveQuestion(surveyId, scaleQuestion(questionId, ON));
    const question = await loadedQuestion(surveyId, questionId);

    const saved = await client.savedQuestions.create({
      question: question as never,
      metadata: { name: '조각-보관함-왕복', category: '테스트' },
    });
    createdSavedIds.push(saved.id);
    const applied = await client.savedQuestions.apply({ id: saved.id });

    expect(applied?.mobileDrilldownReverseColumns).toBe(true);
    expect(applied?.mobileDrilldownColumnsPerView).toBe(6);
    expect(applied?.id).not.toBe(questionId);
  });
});
