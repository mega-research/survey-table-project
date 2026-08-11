import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 응답 버전 이관 — 익명 재개 경로 (ADR-0014, .scratch/response-version-migration 티켓 02)
// ========================
// 구버전에 고정된 익명(sessionId) 미완료 응답을 재개하면:
// - 행의 versionId 를 현재 버전으로 재고정하고
// - metadata 에 이관 출처(migratedFromVersionId)를 기록하며 (jsonb_set — draftSeq 등 보존)
// - 기존 답변을 구조 생존 판정으로 걸러 저장·복원하고
// - 영향받은 질문 ID 목록을 복원 payload 에 담는다.
// 버전 일치·versionId 미연결(레거시)·현재 스냅샷 훼손 시에는 기존 동작 그대로다.

const { selectQueue, selectMock, updateSetCalls, updateReturningMock } = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  selectMock: vi.fn(),
  updateSetCalls: [] as Record<string, unknown>[],
  updateReturningMock: vi.fn(),
}));

vi.mock('@/db', () => {
  selectMock.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectQueue.shift() ?? []),
      })),
    })),
  }));
  return {
    db: {
      select: selectMock,
      update: vi.fn(() => ({
        set: vi.fn((arg: Record<string, unknown>) => {
          updateSetCalls.push(arg);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(() => updateReturningMock()),
              then: (resolve: (v: unknown) => unknown) => resolve(undefined),
            })),
          };
        }),
      })),
    },
  };
});

vi.mock('@/lib/survey-control', () => ({
  getSurveyControlFlags: vi.fn().mockResolvedValue({
    isPaused: false,
    pausedMessage: null,
    testModeEnabled: false,
    testToken: null,
    currentVersionId: 'v-current',
  }),
  isValidTestToken: vi.fn(() => false),
}));

vi.mock('@/lib/duplicate-detection/invite-lookup', () => ({
  findContactByInviteToken: vi.fn(),
}));

import { resumeOrCreateResponse } from '@/features/survey-response/server/services/lifecycle.service';

const ROW_BASE = {
  id: 'response-1',
  status: 'in_progress',
  isTest: false,
  versionId: 'v-old',
  questionResponses: { 'q-radio': 'ghost-value', 'q-text': '유지되는 답' },
  currentStepId: 'page:q-text',
  metadata: { draftSeq: 5 },
};

// 신버전 스냅샷: q-radio 는 옵션이 줄었고(ghost-value 삭제), q-text 는 그대로.
const CURRENT_SNAPSHOT = {
  questions: [
    {
      id: 'q-radio',
      type: 'radio',
      title: '보기',
      required: false,
      order: 0,
      options: [{ id: 'o1', label: 'A', value: '1' }],
    },
    { id: 'q-text', type: 'text', title: '단답', required: false, order: 1 },
  ],
};

function migrationSet(): Record<string, unknown> | undefined {
  return updateSetCalls.find((s) => s['versionId'] !== undefined);
}

describe('resumeOrCreateResponse — 익명 재개 이관', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updateSetCalls.length = 0;
    selectMock.mockClear(); // 구현은 유지하고 호출 이력만 초기화 (테스트 간 격리)
    updateReturningMock.mockReset();
    updateReturningMock.mockResolvedValue([{ id: 'response-1' }]);
  });

  const resume = () => resumeOrCreateResponse({ surveyId: 'survey-1', sessionId: 'saved-session' });

  it('구버전 in_progress 행을 현재 버전으로 재고정하고 생존 답변과 영향 질문을 돌려준다', async () => {
    selectQueue.push([ROW_BASE], [{ snapshot: CURRENT_SNAPSHOT }]);

    const result = await resume();

    expect(result).toMatchObject({
      id: 'response-1',
      status: 'in_progress',
      resumed: false,
      questionResponses: { 'q-text': '유지되는 답' },
      currentStepId: 'page:q-text',
      affectedQuestionIds: ['q-radio'],
      draftSeq: 5,
    });
    expect(result?.questionResponses).not.toHaveProperty('q-radio');

    const set = migrationSet();
    expect(set).toBeDefined();
    expect(set?.['versionId']).toBe('v-current');
    expect(set?.['questionResponses']).toEqual({ 'q-text': '유지되는 답' });
    // metadata 는 통 객체 교체가 아니라 jsonb_set SQL 이어야 한다 (draftSeq 보존)
    expect(typeof set?.['metadata']).toBe('object');
    expect(set?.['metadata']).not.toEqual(expect.objectContaining({ draftSeq: expect.anything() }));
  });

  it('구버전 drop 행은 이관과 동시에 in_progress 로 되살린다', async () => {
    selectQueue.push([{ ...ROW_BASE, status: 'drop' }], [{ snapshot: CURRENT_SNAPSHOT }]);

    const result = await resume();

    expect(result).toMatchObject({
      status: 'in_progress',
      resumed: true,
      affectedQuestionIds: ['q-radio'],
    });
    const set = migrationSet();
    expect(set?.['status']).toBe('in_progress');
    expect(set?.['versionId']).toBe('v-current');
  });

  it('버전이 일치하면 이관하지 않는다 — 스냅샷 조회도 없다', async () => {
    selectQueue.push([{ ...ROW_BASE, versionId: 'v-current' }]);

    const result = await resume();

    expect(result).toMatchObject({
      questionResponses: { 'q-radio': 'ghost-value', 'q-text': '유지되는 답' },
    });
    expect(result).not.toHaveProperty('affectedQuestionIds');
    expect(migrationSet()).toBeUndefined();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it('versionId 미연결(레거시) 행은 이관하지 않는다', async () => {
    selectQueue.push([{ ...ROW_BASE, versionId: null }]);

    const result = await resume();

    expect(result).toMatchObject({
      questionResponses: { 'q-radio': 'ghost-value', 'q-text': '유지되는 답' },
    });
    expect(result).not.toHaveProperty('affectedQuestionIds');
    expect(migrationSet()).toBeUndefined();
  });

  it('현재 스냅샷이 훼손(questions 비배열)이면 이관을 보류하고 기존 동작을 유지한다', async () => {
    selectQueue.push([ROW_BASE], [{ snapshot: {} }]);

    const result = await resume();

    expect(result).toMatchObject({
      questionResponses: { 'q-radio': 'ghost-value', 'q-text': '유지되는 답' },
    });
    expect(result).not.toHaveProperty('affectedQuestionIds');
    expect(migrationSet()).toBeUndefined();
  });

  it('영향 질문이 없으면 affectedQuestionIds 를 생략하되 재고정은 수행한다', async () => {
    selectQueue.push(
      [{ ...ROW_BASE, questionResponses: { 'q-text': '유지되는 답' } }],
      [{ snapshot: CURRENT_SNAPSHOT }],
    );

    const result = await resume();

    expect(result).toMatchObject({ questionResponses: { 'q-text': '유지되는 답' } });
    expect(result).not.toHaveProperty('affectedQuestionIds');
    expect(migrationSet()?.['versionId']).toBe('v-current');
  });

  it('이관 UPDATE 가 경합으로 0행이면(동시 이관) 기존 동작으로 폴백한다', async () => {
    updateReturningMock.mockResolvedValue([]);
    selectQueue.push([ROW_BASE], [{ snapshot: CURRENT_SNAPSHOT }]);

    const result = await resume();

    expect(result).toMatchObject({
      questionResponses: { 'q-radio': 'ghost-value', 'q-text': '유지되는 답' },
    });
    expect(result).not.toHaveProperty('affectedQuestionIds');
  });
});
