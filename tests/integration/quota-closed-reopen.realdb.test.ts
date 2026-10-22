/**
 * 쿼터 마감 응답 다시 열기 — 실DB 왕복.
 *
 * 2026-10-22 팹리스 수요기업 조사: 「스마트 도시 및 인프라/통신」 목표를 25 → 30 으로 올렸는데
 * 25 일 때 막힌 10명이 같은 초대 링크로 들어와도 계속 마감 화면을 봤다. quotaful_out 은 한 번
 * 찍히면 재진입 판정(decideResponseReuse)이 목표를 다시 보지 않았기 때문이다.
 *
 * 바뀐 규칙: 재진입 때 그 응답의 셀에 지금 자리가 있으면 마감을 풀고 남겨 둔 답으로 이어 간다.
 * 자리가 없으면 종전대로 막는다. 자리를 예약하지는 않는다 — 초과 방지는 종전대로
 * 페이지 재확인(checkQuota)과 제출 시점 하드 차단이 맡는다.
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요). 워크트리 공용 DB 라 실행 전 상태 확인.
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindContactByInviteToken } = vi.hoisted(() => ({
  mockFindContactByInviteToken: vi.fn(),
}));

// findContactByInviteToken 은 PG SECURITY DEFINER 함수에 기대므로 valid 로 고정한다.
vi.mock('@/server/read-models/invite-lookup', () => ({
  findContactByInviteToken: mockFindContactByInviteToken,
}));

import { db } from '@/db';
import { contactTargets, surveys, surveyResponses, surveyVersions } from '@/db/schema';
import { generateInviteCode } from '@/lib/survey-url';
import type { QuotaConfig } from '@/shared/contracts/quota';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
import { resumeOrCreateResponse } from '@/server/survey-response/services/lifecycle';
import { insertResponseWithContactReuse } from '@/server/survey-response/services/response-row-create';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const ATTR_KEY = '산업 분야';
const ATTR_VALUE = '스마트 도시 및 인프라/통신';
const SAVED_ANSWERS = { 'q-consent': '동의' };
const INVITE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const createdSurveyIds: string[] = [];

function plan(target: number): QuotaConfig {
  return {
    enabled: true,
    dimensions: [
      {
        id: 'dim-industry',
        questionId: '',
        label: ATTR_KEY,
        kind: 'attr',
        attrKey: ATTR_KEY,
        categories: [{ id: 'cat-city', label: ATTR_VALUE, values: [ATTR_VALUE] }],
      },
    ],
    cells: [{ categoryIds: ['cat-city'], target }],
    closedMessage: '마감되었습니다.',
    midSurveyClose: true,
    midSurveyClosedMessage: null,
  };
}

const snapshot: SurveyVersionSnapshot = {
  title: '쿼터 마감 다시 열기',
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
  questions: [
    {
      id: 'q-consent',
      type: 'radio',
      title: '동의',
      required: true,
      order: 0,
      options: [{ id: 'opt-y', label: '동의', value: '동의' }],
    },
  ],
};

/**
 * 목표 `target` 인 설문에 완료 1건(같은 셀) + 마감 응답 1건을 심는다.
 * 마감 응답은 조사 대상에 묶이고 답 하나를 남겨 둔 상태다.
 */
async function seed(target: number) {
  const [survey] = await db
    .insert(surveys)
    .values({ title: '쿼터 마감 다시 열기', status: 'published', quotaConfig: plan(target) })
    .returning({ id: surveys.id });
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);

  const [version] = await db
    .insert(surveyVersions)
    .values({
      surveyId: survey.id,
      versionNumber: 1,
      status: 'published',
      snapshot,
      publishedAt: new Date(),
    })
    .returning({ id: surveyVersions.id });
  if (!version) throw new Error('버전 시드 실패');
  await db.update(surveys).set({ currentVersionId: version.id }).where(eq(surveys.id, survey.id));

  const [doneContact, closedContact] = await db
    .insert(contactTargets)
    .values([1, 2].map((resid) => ({
      surveyId: survey.id,
      resid,
      inviteCode: generateInviteCode(),
      attrs: { [ATTR_KEY]: ATTR_VALUE },
    })))
    .returning({ id: contactTargets.id });
  if (!doneContact || !closedContact) throw new Error('조사 대상 시드 실패');

  await db.insert(surveyResponses).values({
    surveyId: survey.id,
    versionId: version.id,
    sessionId: `done-${crypto.randomUUID()}`,
    contactTargetId: doneContact.id,
    status: 'completed',
    isCompleted: true,
    completedAt: new Date(),
    questionResponses: SAVED_ANSWERS,
  });

  const closedSessionId = `closed-${crypto.randomUUID()}`;
  const [closed] = await db
    .insert(surveyResponses)
    .values({
      surveyId: survey.id,
      versionId: version.id,
      sessionId: closedSessionId,
      contactTargetId: closedContact.id,
      status: 'quotaful_out',
      isCompleted: false,
      currentStepId: 'page:1',
      questionResponses: SAVED_ANSWERS,
    })
    .returning({ id: surveyResponses.id });
  if (!closed) throw new Error('마감 응답 시드 실패');

  return {
    surveyId: survey.id,
    versionId: version.id,
    closedContactId: closedContact.id,
    closedResponseId: closed.id,
    closedSessionId,
  };
}

async function loadRow(responseId: string) {
  const [row] = await db
    .select({
      status: surveyResponses.status,
      questionResponses: surveyResponses.questionResponses,
    })
    .from(surveyResponses)
    .where(eq(surveyResponses.id, responseId));
  return row;
}

describe.skipIf(!isLocalDb)('쿼터 마감 응답 다시 열기 (real local DB)', () => {
  beforeEach(() => vi.clearAllMocks());

  afterAll(async () => {
    if (createdSurveyIds.length === 0) return;
    // 조사 대상·응답·버전은 설문 FK cascade 로 정리된다.
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  });

  it('초대 링크 재진입: 목표가 늘어 자리가 있으면 마감을 풀고 남긴 답으로 이어 간다', async () => {
    const s = await seed(2);
    mockFindContactByInviteToken.mockResolvedValue({
      kind: 'valid',
      contactTargetId: s.closedContactId,
      respondedAt: null,
      isTest: false,
    });

    const result = await resumeOrCreateResponse({
      surveyId: s.surveyId,
      sessionId: 'another-device',
      inviteToken: INVITE,
    });

    expect(result).toMatchObject({
      id: s.closedResponseId,
      status: 'in_progress',
      questionResponses: SAVED_ANSWERS,
      currentStepId: 'page:1',
    });
    const row = await loadRow(s.closedResponseId);
    expect(row?.status).toBe('in_progress');
    expect(row?.questionResponses).toEqual(SAVED_ANSWERS);
  });

  it('초대 링크 재진입: 여전히 가득 차 있으면 마감 그대로 둔다', async () => {
    const s = await seed(1);
    mockFindContactByInviteToken.mockResolvedValue({
      kind: 'valid',
      contactTargetId: s.closedContactId,
      respondedAt: null,
      isTest: false,
    });

    const result = await resumeOrCreateResponse({
      surveyId: s.surveyId,
      sessionId: 'another-device',
      inviteToken: INVITE,
    });

    expect(result).toBeNull();
    expect((await loadRow(s.closedResponseId))?.status).toBe('quotaful_out');
  });

  it('같은 브라우저 재진입: 자리가 있으면 이어 가고, 없으면 마감 상태를 돌려준다', async () => {
    const open = await seed(2);
    const reopened = await resumeOrCreateResponse({
      surveyId: open.surveyId,
      sessionId: open.closedSessionId,
    });
    expect(reopened).toMatchObject({
      id: open.closedResponseId,
      status: 'in_progress',
      questionResponses: SAVED_ANSWERS,
    });
    expect((await loadRow(open.closedResponseId))?.status).toBe('in_progress');

    const full = await seed(1);
    const blocked = await resumeOrCreateResponse({
      surveyId: full.surveyId,
      sessionId: full.closedSessionId,
    });
    expect(blocked).toMatchObject({ id: full.closedResponseId, status: 'quotaful_out' });
    expect((await loadRow(full.closedResponseId))?.status).toBe('quotaful_out');
  });

  it('첫 답 저장 경로: 자리가 있으면 마감 행을 되살려 물려받는다(새 행을 만들지 않는다)', async () => {
    const s = await seed(2);

    const outcome = await insertResponseWithContactReuse({
      surveyId: s.surveyId,
      sessionId: 'another-device',
      contactTargetId: s.closedContactId,
      newResponse: {
        surveyId: s.surveyId,
        versionId: s.versionId,
        sessionId: 'another-device',
        contactTargetId: s.closedContactId,
        questionResponses: {},
      },
    });

    expect(outcome).toMatchObject({ kind: 'ready', row: { id: s.closedResponseId } });
    const row = await loadRow(s.closedResponseId);
    expect(row?.status).toBe('in_progress');
    expect(row?.questionResponses).toEqual(SAVED_ANSWERS);
  });

  it('첫 답 저장 경로: 여전히 가득 차 있으면 종전대로 쿼터 마감으로 막는다', async () => {
    const s = await seed(1);

    const outcome = await insertResponseWithContactReuse({
      surveyId: s.surveyId,
      sessionId: 'another-device',
      contactTargetId: s.closedContactId,
      newResponse: {
        surveyId: s.surveyId,
        versionId: s.versionId,
        sessionId: 'another-device',
        contactTargetId: s.closedContactId,
        questionResponses: {},
      },
    });

    expect(outcome).toEqual({ kind: 'blocked', reason: 'quota_closed' });
    expect((await loadRow(s.closedResponseId))?.status).toBe('quotaful_out');
  });
});
