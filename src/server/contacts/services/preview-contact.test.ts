import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadPreviewContactSeed } from './preview-contact';

// 「설문 보기」가 싣는 첫 번째 조사 대상 — 파티션 안 resid 최소, 개인정보 열은 설문이 읽는 열만.
const limitMock = vi.fn();
const calls: { where?: unknown; orderBy?: unknown } = {};
vi.mock('@/db', () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        where: (w: unknown) => ((calls.where = w), chain),
        orderBy: (o: unknown) => ((calls.orderBy = o), chain),
        limit: async () => limitMock(),
      };
      return chain;
    },
  },
}));

const appendContactPii = vi.fn();
vi.mock('@/server/read-models/respondent-contact-attrs', () => ({
  appendContactPii: (...args: unknown[]) => appendContactPii(...args),
}));
const lookupPriorAnswersByContactTarget = vi.fn();
vi.mock('@/server/read-models/contact-prior-answers', () => ({
  lookupPriorAnswersByContactTarget: (...args: unknown[]) => lookupPriorAnswersByContactTarget(...args),
}));

const SURVEY = '11111111-1111-4111-8111-111111111111';

describe('loadPreviewContactSeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.where = undefined;
    calls.orderBy = undefined;
  });

  it('조사 대상이 없으면 null — 미리보기는 지금처럼 빈 명단 값으로 열린다', async () => {
    limitMock.mockResolvedValue([]);
    expect(await loadPreviewContactSeed({ surveyId: SURVEY, isTest: false, structure: {} })).toBeNull();
    expect(appendContactPii).not.toHaveBeenCalled();
  });

  it('resid 순으로 첫 대상을 고르고 명단 값·이월 응답을 함께 싣는다', async () => {
    limitMock.mockResolvedValue([{ id: 't1', resid: 3, attrs: { 업체명: '메가' } }]);
    appendContactPii.mockResolvedValue({ 업체명: '메가', 대표자명: '홍길동' });
    lookupPriorAnswersByContactTarget.mockResolvedValue({ q1: '작년 값' });

    const seed = await loadPreviewContactSeed({ surveyId: SURVEY, isTest: true, structure: {} });

    expect(calls.orderBy).toBeDefined();
    expect(seed).toEqual({
      resid: 3,
      isTest: true,
      contactAttrs: { 업체명: '메가', 대표자명: '홍길동' },
      priorAnswers: { q1: '작년 값' },
    });
    expect(lookupPriorAnswersByContactTarget).toHaveBeenCalledWith({ surveyId: SURVEY, contactTargetId: 't1', isTest: true });
  });

  it('개인정보 열은 설문 구조가 읽는 열만 합친다 — 응답자 경로와 같은 규칙', async () => {
    limitMock.mockResolvedValue([{ id: 't1', resid: 1, attrs: {} }]);
    appendContactPii.mockResolvedValue({});
    lookupPriorAnswersByContactTarget.mockResolvedValue(null);

    await loadPreviewContactSeed({
      surveyId: SURVEY,
      isTest: false,
      structure: { questions: [{ title: '{{대표자명 || 업체명}} 님' }] },
    });

    const options = appendContactPii.mock.calls[0]![1] as { allowedKeys: () => Promise<ReadonlySet<string>> };
    expect([...(await options.allowedKeys())].sort()).toEqual(['대표자명', '업체명']);
  });
});
