import { beforeEach, describe, expect, it, vi } from 'vitest';

const groupBy = vi.fn();
const where = vi.fn(() => ({ groupBy }));
const from = vi.fn(() => ({ where }));
const dbSelect = vi.fn((_selection: unknown) => ({ from }));

vi.mock('@/db', () => ({
  db: {
    select: (selection: unknown) => dbSelect(selection),
  },
}));

import { getResponseCountsGroupedBySurvey } from './responses';

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
