import { beforeEach, describe, expect, it, vi } from 'vitest';

const groupBy = vi.fn();
const where = vi.fn(() => ({ groupBy }));
const from = vi.fn(() => ({ where }));
const dbSelect = vi.fn((_selection: unknown) => ({ from }));
const findMany = vi.fn();

vi.mock('@/db', () => ({
  db: {
    select: (selection: unknown) => dbSelect(selection),
    query: { surveyResponses: { findMany: (args: unknown) => findMany(args) } },
  },
}));

vi.mock('@/lib/crypto/response-pii', () => ({
  decryptQuestionResponses: (responses: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(responses).map(([k, v]) => [
        k,
        typeof v === 'string' && v.startsWith('v1:') ? `평문(${v.slice(3)})` : v,
      ]),
    ),
}));

import { getCompletedResponsesForAnalysis, getResponseCountsGroupedBySurvey } from './responses';

describe('getResponseCountsGroupedBySurvey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('survey id 목록이 비어 있으면 DB 조회 없이 빈 Map 을 반환한다', async () => {
    const result = await getResponseCountsGroupedBySurvey([]);

    expect(result.size).toBe(0);
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it('집계 rows 를 total/completed 숫자 Map 으로 변환한다', async () => {
    groupBy.mockResolvedValue([
      { surveyId: 'survey-1', total: '5', completed: '3' },
      { surveyId: 'survey-2', total: 2, completed: 1 },
    ]);

    const result = await getResponseCountsGroupedBySurvey(['survey-1', 'survey-2']);

    expect(dbSelect).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      new Map([
        ['survey-1', { total: 5, completed: 3 }],
        ['survey-2', { total: 2, completed: 1 }],
      ]),
    );
  });
});

describe('getCompletedResponsesForAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('응답 원본(question_responses)을 복호화해 그대로 돌려준다 — 문항별 사본을 조인하지 않는다', async () => {
    findMany.mockResolvedValue([
      {
        id: 'r1',
        isCompleted: true,
        questionResponses: { 'q-name': 'v1:홍길동', 'q-radio': '2', __optTexts__: { 'q-radio': {} } },
      },
    ]);

    const result = await getCompletedResponsesForAnalysis('survey-1');

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty('with');
    expect(result).toEqual([
      {
        id: 'r1',
        isCompleted: true,
        questionResponses: {
          'q-name': '평문(홍길동)',
          'q-radio': '2',
          __optTexts__: { 'q-radio': {} },
        },
      },
    ]);
  });
});
