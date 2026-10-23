/**
 * 테스트 버전 위의 테스트 응답 — 고정 · 확정 · 테스트 중 저장 · 다시 들어오기를 실DB 왕복으로 확인한다.
 *
 * - 테스트 응답은 테스트 버전에, 실응답은 배포본에 고정된다(서로의 버전 id 를 보내도 제자리로)
 * - 한 번도 배포하지 않은 설문의 테스트 응답도 응답 확정이 돈다
 * - 테스트 중 저장본이 바뀌면 옛 테스트 버전 위의 저장은 안내로 멈춘다
 * - 빌더에서 저장만 해도(테스트 화면을 다시 열지 않아도) 다음 저장이 안내로 멈춘다
 * - 다시 들어오면 새 테스트 버전으로 옮기고, 바뀐 문항(문구만 바뀌어도)을 데려갈 곳으로 알린다
 * - 관리자 응답 수정은 테스트 응답을 테스트 버전으로 고치고 테스트 버전에 둔다
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요)
 */
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve(
      new Headers({ 'x-real-ip': '203.0.113.9', 'user-agent': 'Vitest test-version response' }),
    ),
  // 관리자 콘솔이 테스트 데이터를 보는 브라우저(「테스트 데이터 보기」 쿠키)
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (name.startsWith('ops-test-view-') ? { value: '1' } : undefined),
    }),
}));

import { db } from '@/db';
import { contactTargets, questions, surveyResponses, surveys } from '@/db/schema';
import { publishSurvey } from '@/server/survey-builder/services/survey-publish';
import { ensureTestVersion } from '@/server/workflows/test-version';
import { resumeOrCreateResponse } from '@/server/survey-response/services/lifecycle';
import { updateQuestionResponse } from '@/server/survey-response/services/response-answer-write';
import { completeResponse } from '@/server/survey-response/services/response-completion';
import { saveDraftResponse } from '@/server/survey-response/services/response-draft';
import { acquireTestTargetResponse } from '@/server/survey-response/services/test-target-attempt';
import { createResponseWithFirstAnswer } from '@/server/survey-response/services/response-entry';
import {
  ResponseEditError,
  saveAdminEdit,
} from '@/server/survey-response/services/response-edit';
import { TestResponseVersionPrunedError } from '@/server/survey-response/services/response-version-snapshot';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];
const TOKEN = 'tvr-token';

/**
 *   1페이지 ctrl  : 예/아니오
 *   1페이지 hid   : ctrl 이 「예」일 때만 보이는 문항
 *   2페이지 later : 평범한 문항
 */
async function seedSurvey() {
  const [survey] = await db
    .insert(surveys)
    .values({ title: '테스트 응답 왕복', isPublic: true, testModeEnabled: true, testToken: TOKEN })
    .returning();
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);
  const [ctrl] = await db
    .insert(questions)
    .values({
      surveyId: survey.id,
      type: 'radio',
      title: '상류',
      order: 0,
      options: [
        { id: 'opt-yes', label: '예', value: 'yes' },
        { id: 'opt-no', label: '아니오', value: 'no' },
      ],
    })
    .returning();
  if (!ctrl) throw new Error('문항 시드 실패');
  const [hid] = await db
    .insert(questions)
    .values({
      surveyId: survey.id,
      type: 'text',
      title: '예일 때만',
      order: 1,
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c1',
            enabled: true,
            logicType: 'AND',
            conditionType: 'value-match',
            sourceQuestionId: ctrl.id,
            requiredValues: ['yes'],
          },
        ],
      },
    })
    .returning();
  const [later] = await db
    .insert(questions)
    .values({ surveyId: survey.id, type: 'text', title: '뒤 페이지', order: 2, pageBreakBefore: true })
    .returning();
  if (!hid || !later) throw new Error('문항 시드 실패');
  return { surveyId: survey.id, ctrl: ctrl.id, hid: hid.id, later: later.id };
}

async function createTestResponse(
  surveyId: string,
  versionId: string | null,
  first: { questionId: string; value: unknown },
  options: { testToken?: string } = { testToken: TOKEN },
) {
  const sessionId = `tvr-${randomUUID()}`;
  const result = await createResponseWithFirstAnswer({
    surveyId,
    sessionId,
    versionId,
    questionId: first.questionId,
    value: first.value,
    currentStepId: 'page:1',
    clientSignals: {
      deviceId: `tvr-device-${randomUUID()}`,
      screen: '1920x1080',
      tz: 'Asia/Seoul',
      lang: 'ko-KR',
      platform: 'MacIntel',
    },
    ...(options.testToken ? { testToken: options.testToken } : {}),
  });
  if (result.kind !== 'created') throw new Error(`응답 생성 실패: ${JSON.stringify(result)}`);
  return { responseId: result.id, sessionId, resultVersionId: result.versionId ?? null };
}

async function rowOf(responseId: string) {
  const [row] = await db
    .select({
      versionId: surveyResponses.versionId,
      status: surveyResponses.status,
      questionResponses: surveyResponses.questionResponses,
    })
    .from(surveyResponses)
    .where(eq(surveyResponses.id, responseId));
  return row;
}

describe.skipIf(!isLocalDb)('테스트 버전 위의 테스트 응답 실DB 왕복', () => {
  afterAll(async () => {
    if (createdSurveyIds.length === 0) return;
    await db.delete(surveyResponses).where(inArray(surveyResponses.surveyId, createdSurveyIds));
    await db.delete(contactTargets).where(inArray(contactTargets.surveyId, createdSurveyIds));
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  });

  it('테스트 응답은 배포본 id 를 보내도 테스트 버전에, 실응답은 테스트 버전 id 를 보내도 배포본에 고정된다', async () => {
    const s = await seedSurvey();
    const published = await publishSurvey({ surveyId: s.surveyId });
    const test = await ensureTestVersion(s.surveyId);

    const testResp = await createTestResponse(s.surveyId, published.id, {
      questionId: s.ctrl,
      value: 'yes',
    });
    const realResp = await createTestResponse(
      s.surveyId,
      test!.versionId,
      { questionId: s.ctrl, value: 'yes' },
      {},
    );

    expect((await rowOf(testResp.responseId))?.versionId).toBe(test?.versionId);
    expect(testResp.resultVersionId).toBe(test?.versionId);
    expect((await rowOf(realResp.responseId))?.versionId).toBe(published.id);
  });

  it('테스트 대상자 응답도 테스트 버전에 고정된다', async () => {
    const s = await seedSurvey();
    await publishSurvey({ surveyId: s.surveyId });
    const test = await ensureTestVersion(s.surveyId);
    const [target] = await db
      .insert(contactTargets)
      .values({ surveyId: s.surveyId, resid: 1, isTest: true, inviteCode: randomUUID() })
      .returning();

    const acquired = await db.transaction((tx) =>
      acquireTestTargetResponse(tx, {
        surveyId: s.surveyId,
        contactTargetId: target!.id,
        sessionId: `tvr-target-${randomUUID()}`,
        attemptId: randomUUID(),
        currentStepId: 'page:1',
      }),
    );

    expect(acquired.versionId).toBe(test?.versionId);
    expect((await rowOf(acquired.responseId))?.versionId).toBe(test?.versionId);
  });

  it('한 번도 배포하지 않은 설문의 테스트 응답도 제출하면 숨은 문항 값을 지운다', async () => {
    const s = await seedSurvey();
    const test = await ensureTestVersion(s.surveyId);
    const { responseId } = await createTestResponse(s.surveyId, test!.versionId, {
      questionId: s.ctrl,
      value: 'no',
    });
    await saveDraftResponse({ responseId, answers: { [s.hid]: '숨기 전에 적은 값' } });

    await completeResponse({ responseId });

    const row = await rowOf(responseId);
    expect(row?.status).toBe('completed');
    expect(row?.questionResponses).toEqual({ [s.ctrl]: 'no' });
  });

  it('테스트 중 저장본이 바뀌면 옛 테스트 버전 위의 답 저장·임시 저장·제출이 안내로 멈춘다', async () => {
    const s = await seedSurvey();
    const test = await ensureTestVersion(s.surveyId);
    const { responseId } = await createTestResponse(s.surveyId, test!.versionId, {
      questionId: s.ctrl,
      value: 'yes',
    });

    await db.update(questions).set({ title: '고친 문구' }).where(eq(questions.id, s.hid));
    await ensureTestVersion(s.surveyId); // 다른 탭에서 테스트 화면을 연다

    await expect(
      updateQuestionResponse({ responseId, questionId: s.hid, value: '답' }),
    ).rejects.toBeInstanceOf(TestResponseVersionPrunedError);
    await expect(
      saveDraftResponse({ responseId, answers: { [s.hid]: '답' } }),
    ).rejects.toBeInstanceOf(TestResponseVersionPrunedError);
    await expect(
      completeResponse({ responseId, data: { questionResponses: { [s.ctrl]: 'yes' } } }),
    ).rejects.toBeInstanceOf(TestResponseVersionPrunedError);
    await expect(completeResponse({ responseId })).rejects.toBeInstanceOf(
      TestResponseVersionPrunedError,
    );
    expect((await rowOf(responseId))?.status).toBe('in_progress');
  });

  it('다시 들어오면 새 테스트 버전으로 옮기고 지운 답과 문구만 바뀐 문항을 데려갈 곳으로 알린다', async () => {
    const s = await seedSurvey();
    const first = await ensureTestVersion(s.surveyId);
    const { responseId, sessionId } = await createTestResponse(s.surveyId, first!.versionId, {
      questionId: s.ctrl,
      value: 'no',
    });
    await saveDraftResponse({ responseId, answers: { [s.later]: '뒤 페이지 답' } });

    // 고른 보기 「아니오」를 지우고, 뒤 페이지 문항 문구만 고친다.
    await db
      .update(questions)
      .set({ options: [{ id: 'opt-yes', label: '예', value: 'yes' }] })
      .where(eq(questions.id, s.ctrl));
    await db.update(questions).set({ title: '문구만 고침' }).where(eq(questions.id, s.later));
    const second = await ensureTestVersion(s.surveyId);

    const resumed = await resumeOrCreateResponse({ surveyId: s.surveyId, sessionId, testToken: TOKEN });

    expect(resumed?.id).toBe(responseId);
    expect(resumed?.questionResponses).toEqual({ [s.later]: '뒤 페이지 답' });
    expect([...(resumed?.affectedQuestionIds ?? [])].sort()).toEqual([s.ctrl, s.later].sort());
    expect((await rowOf(responseId))?.versionId).toBe(second?.versionId);
  });

  it('빌더에서 저장만 해도 진행 중인 테스트 응답의 다음 답 저장·임시 저장·제출이 안내로 멈춘다', async () => {
    const s = await seedSurvey();
    const test = await ensureTestVersion(s.surveyId);
    const { responseId } = await createTestResponse(s.surveyId, test!.versionId, {
      questionId: s.ctrl,
      value: 'yes',
    });

    // 빌더 저장 — 아무도 테스트 화면이나 관리자 미리보기를 다시 열지 않는다
    await db.update(questions).set({ title: '빌더에서 고친 문구' }).where(eq(questions.id, s.hid));

    await expect(
      updateQuestionResponse({ responseId, questionId: s.hid, value: '답' }),
    ).rejects.toBeInstanceOf(TestResponseVersionPrunedError);
    await expect(
      saveDraftResponse({ responseId, answers: { [s.hid]: '답' } }),
    ).rejects.toBeInstanceOf(TestResponseVersionPrunedError);
    await expect(completeResponse({ responseId })).rejects.toBeInstanceOf(
      TestResponseVersionPrunedError,
    );
    expect((await rowOf(responseId))?.status).toBe('in_progress');
  });

  it('저장본이 그대로면 테스트 응답 저장은 새 테스트 버전을 만들지 않고 그대로 저장된다', async () => {
    const s = await seedSurvey();
    const test = await ensureTestVersion(s.surveyId);
    const { responseId } = await createTestResponse(s.surveyId, test!.versionId, {
      questionId: s.ctrl,
      value: 'yes',
    });

    await updateQuestionResponse({ responseId, questionId: s.hid, value: '답' });

    expect((await ensureTestVersion(s.surveyId))?.versionId).toBe(test?.versionId);
    expect((await rowOf(responseId))?.questionResponses).toEqual({ [s.ctrl]: 'yes', [s.hid]: '답' });
  });

  it('관리자 응답 수정은 테스트 응답을 배포본이 아니라 테스트 버전 기준으로 고치고 테스트 버전에 둔다', async () => {
    const s = await seedSurvey();
    const published = await publishSurvey({ surveyId: s.surveyId });
    // 배포 뒤 저장본만 고친다 — 테스트 버전과 배포본이 갈린다
    await db.update(questions).set({ title: '배포 뒤 고친 문구' }).where(eq(questions.id, s.later));
    const test = await ensureTestVersion(s.surveyId);
    expect(test?.versionId).not.toBe(published.id);
    const { responseId } = await createTestResponse(s.surveyId, test!.versionId, {
      questionId: s.ctrl,
      value: 'yes',
    });

    // 배포본 기준으로 그린 화면의 저장은 받지 않는다
    await expect(
      saveAdminEdit(
        { surveyId: s.surveyId, responseId, versionId: published.id, questionResponses: { [s.ctrl]: 'no' } },
        { attribution: { accountUserId: null, fieldworkLinkId: null }, email: null },
        false,
      ),
    ).rejects.toBeInstanceOf(ResponseEditError);

    await saveAdminEdit(
      {
        surveyId: s.surveyId,
        responseId,
        versionId: test!.versionId,
        questionResponses: { [s.ctrl]: 'yes', [s.hid]: '관리자가 적은 값' },
      },
      { attribution: { accountUserId: null, fieldworkLinkId: null }, email: null },
      false,
    );

    const row = await rowOf(responseId);
    expect(row?.versionId).toBe(test?.versionId);
    expect(row?.questionResponses).toEqual({ [s.ctrl]: 'yes', [s.hid]: '관리자가 적은 값' });
  });
});
