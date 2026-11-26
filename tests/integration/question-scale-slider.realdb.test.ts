/**
 * 문항의 슬라이더 방향(`questions.scale_slider`, 0173) — 실 DB 왕복.
 *
 * 이 컬럼은 화면이 없는 채로 먼저 들어온다. 값이 빌더 저장 → DB → 빌더 로드 → 발행 스냅샷 → 복제 → 보관함을
 * 도는 동안 한 곳이라도 빠지면 아무 오류 없이 슬라이더가 꺼진다(noticeBgColor·priorAnswerDisabled 가 그렇게
 * 새어 나갔다). 단위 테스트는 매퍼·스냅샷·스키마를 따로 보므로, 여기서 procedure → service → PostgreSQL 을
 * 실제로 왕복시켜 이음매를 본다. CHECK 제약(모르는 값 거부)도 실 DB 에서만 확인된다.
 *
 * 실행: 전용 DB 에서만 — `pnpm db:isolated <이름>` 이 출력한 URL 로
 *   RUN_REALDB=1 DATABASE_URL=<URL> pnpm exec vitest run tests/integration/question-scale-slider.realdb.test.ts
 *
 * R2 회피: 이미지·첨부가 없는 평문 문항만 쓴다(promote 는 tmp/ 접두 URL 이 있을 때만 R2 를 부른다) —
 * 빌더 저장·보관함 둘 다 모킹 없이 돈다.
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
import { SCALE_SLIDER_DIRECTIONS } from '@/types/scale-slider';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

// 역할 모델 v2: 생성은 팀 범위를, 저장·발행은 capability 를 요구하므로 실사용자·팀·멤버십 픽스처가 있어야 한다.
const ACTOR_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();
const ACTOR_EMAIL = `scale-slider-${ACTOR_ID}@example.com`;

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

function radioQuestion(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'radio',
    title: '추천 의향',
    required: true,
    order: 1,
    options: [
      { id: 'o1', label: '전혀 추천하지 않는다', value: '1' },
      { id: 'o2', label: '보통이다', value: '2' },
      { id: 'o3', label: '매우 추천한다', value: '3' },
    ],
    ...extra,
  };
}

describe.skipIf(!isLocalDb)('문항의 슬라이더 방향 — 실 DB 왕복', () => {
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

  async function storedDirection(questionId: string): Promise<string | null | undefined> {
    const [row] = await db
      .select({ scaleSlider: questionsTable.scaleSlider })
      .from(questionsTable)
      .where(eq(questionsTable.id, questionId));
    return row?.scaleSlider;
  }

  async function loadedQuestion(surveyId: string, questionId: string) {
    const loaded = await client.read.withDetails({ surveyId });
    const question = loaded?.questions.find((q) => q.id === questionId);
    if (!question) throw new Error('저장한 문항이 로드 결과에 없다');
    return question;
  }

  it.each(SCALE_SLIDER_DIRECTIONS)(
    '빌더 저장 → 로드: %s 가 컬럼에 들어가고 그대로 읽힌다',
    async (direction) => {
      const surveyId = await newSurvey(`슬라이더-왕복-${direction}`);
      const questionId = crypto.randomUUID();

      await saveQuestion(surveyId, radioQuestion(questionId, { scaleSlider: direction }));

      expect(await storedDirection(questionId)).toBe(direction);
      expect((await loadedQuestion(surveyId, questionId)).scaleSlider).toBe(direction);
    },
  );

  it('값이 없는 문항은 NULL 로 저장되고 로드 결과에 키가 없다', async () => {
    const surveyId = await newSurvey('슬라이더-없음');
    const questionId = crypto.randomUUID();

    await saveQuestion(surveyId, radioQuestion(questionId));

    expect(await storedDirection(questionId)).toBeNull();
    expect('scaleSlider' in (await loadedQuestion(surveyId, questionId))).toBe(false);
  });

  it('빌더 저장에서 값을 지우면 NULL 로 돌아간다 — 싣지 않은 것과 null 둘 다', async () => {
    const surveyId = await newSurvey('슬라이더-지우기');
    const questionId = crypto.randomUUID();

    await saveQuestion(surveyId, radioQuestion(questionId, { scaleSlider: 'positive-right' }));
    expect(await storedDirection(questionId)).toBe('positive-right');

    // 빌더 저장은 문항을 통째로 다시 쓴다 — 키가 없으면 꺼진 것이다
    await saveQuestion(surveyId, radioQuestion(questionId));
    expect(await storedDirection(questionId)).toBeNull();

    await saveQuestion(surveyId, radioQuestion(questionId, { scaleSlider: 'positive-left' }));
    await saveQuestion(surveyId, radioQuestion(questionId, { scaleSlider: null }));
    expect(await storedDirection(questionId)).toBeNull();
    expect('scaleSlider' in (await loadedQuestion(surveyId, questionId))).toBe(false);
  });

  it('문항 생성·수정: 방향을 싣고, 다른 필드만 고치면 그대로 두고, null 로 끈다', async () => {
    const surveyId = await newSurvey('슬라이더-문항-수정');
    const questionId = crypto.randomUUID();

    await client.questions.create({
      surveyId,
      id: questionId,
      type: 'radio',
      title: '추천 의향',
      scaleSlider: 'positive-left',
    });
    expect(await storedDirection(questionId)).toBe('positive-left');

    // 부분 수정 — 싣지 않은 필드는 건드리지 않는다
    await client.questions.update({ questionId, surveyId, data: { title: '제목만 고침' } });
    expect(await storedDirection(questionId)).toBe('positive-left');

    await client.questions.update({
      questionId,
      surveyId,
      data: { scaleSlider: 'positive-right' },
    });
    expect(await storedDirection(questionId)).toBe('positive-right');

    await client.questions.update({ questionId, surveyId, data: { scaleSlider: null } });
    expect(await storedDirection(questionId)).toBeNull();
  });

  it('문항 생성: 방향을 싣지 않으면 NULL 이다', async () => {
    const surveyId = await newSurvey('슬라이더-문항-생성-없음');
    const questionId = crypto.randomUUID();

    await client.questions.create({ surveyId, id: questionId, type: 'radio', title: '추천 의향' });

    expect(await storedDirection(questionId)).toBeNull();
  });

  it('모르는 값은 저장에서 거부된다 — 문항 수정은 입력 검증, 빌더 저장과 직접 INSERT 는 CHECK', async () => {
    const surveyId = await newSurvey('슬라이더-모르는-값');
    const questionId = crypto.randomUUID();
    await saveQuestion(surveyId, radioQuestion(questionId, { scaleSlider: 'positive-left' }));

    await expect(
      client.questions.update({
        questionId,
        surveyId,
        data: { scaleSlider: 'sideways' as never },
      }),
    ).rejects.toThrow();

    await expect(
      saveQuestion(surveyId, radioQuestion(questionId, { scaleSlider: 'sideways' })),
    ).rejects.toThrow();

    const insertUnknown = db.insert(questionsTable).values({
      id: crypto.randomUUID(),
      surveyId,
      type: 'radio',
      title: 'CHECK 확인',
      order: 2,
      scaleSlider: 'sideways' as never,
    });
    await expect(insertUnknown).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'questions_scale_slider_check' },
    });

    // 거부된 저장은 있던 값을 건드리지 않는다
    expect(await storedDirection(questionId)).toBe('positive-left');
  });

  it('발행 스냅샷: 켠 문항은 방향이 얼고, 꺼진 문항에는 키가 없다', async () => {
    const surveyId = await newSurvey('슬라이더-발행');
    const onId = crypto.randomUUID();
    const offId = crypto.randomUUID();
    await client.save.saveDiff({
      surveyId,
      questionChanges: {
        upserted: [
          radioQuestion(onId, { scaleSlider: 'positive-left', order: 1 }),
          radioQuestion(offId, { order: 2 }),
        ] as never,
        deleted: [],
      },
    });

    const version = await client.publish.publish({ surveyId, changeNote: '슬라이더' });
    const [row] = await db
      .select({ snapshot: surveyVersionsTable.snapshot })
      .from(surveyVersionsTable)
      .where(eq(surveyVersionsTable.id, version.id));
    const frozen = (row?.snapshot?.questions ?? []) as unknown as Record<string, unknown>[];

    expect(frozen.find((q) => q['id'] === onId)?.['scaleSlider']).toBe('positive-left');
    const off = frozen.find((q) => q['id'] === offId);
    expect(off).toBeDefined();
    expect('scaleSlider' in off!).toBe(false);
  });

  it('설문 복제: 방향이 따라오고 꺼진 문항은 꺼진 채다', async () => {
    const surveyId = await newSurvey('슬라이더-복제-원본');
    await client.save.saveDiff({
      surveyId,
      questionChanges: {
        upserted: [
          radioQuestion(crypto.randomUUID(), { scaleSlider: 'positive-left', order: 1 }),
          radioQuestion(crypto.randomUUID(), { order: 2 }),
        ] as never,
        deleted: [],
      },
    });

    const copy = await client.surveys.duplicate({ surveyId });
    if (!copy) throw new Error('duplicate 가 null 을 반환했다');
    createdSurveyIds.push(copy.id);

    const copied = await db
      .select({ order: questionsTable.order, scaleSlider: questionsTable.scaleSlider })
      .from(questionsTable)
      .where(eq(questionsTable.surveyId, copy.id));
    const byOrder = new Map(copied.map((q) => [q.order, q.scaleSlider]));

    expect(byOrder.get(1)).toBe('positive-left');
    expect(byOrder.get(2)).toBeNull();
  });

  it('보관함: 넣었다 꺼내도 방향이 따라온다', async () => {
    const surveyId = await newSurvey('슬라이더-보관함');
    const questionId = crypto.randomUUID();
    await saveQuestion(surveyId, radioQuestion(questionId, { scaleSlider: 'positive-left' }));
    const question = await loadedQuestion(surveyId, questionId);

    const saved = await client.savedQuestions.create({
      question: question as never,
      metadata: { name: '슬라이더-보관함-왕복', category: '테스트' },
    });
    createdSavedIds.push(saved.id);
    const applied = await client.savedQuestions.apply({ id: saved.id });

    expect(applied?.scaleSlider).toBe('positive-left');
    expect(applied?.id).not.toBe(questionId);
  });
});
