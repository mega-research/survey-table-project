import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadIdListsForValues } from './contact-id-lists.server';

const state = {
  rows: [] as Array<{ id: string; ids: number[] }>,
  selectCalls: 0,
};

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => {
      state.selectCalls += 1;
      const chain = {
        from: () => chain,
        where: () => Promise.resolve(state.rows),
      };
      return chain;
    }),
  },
}));

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';
const LIST_A = '0f3a4b5c-1111-4222-8333-444455556666';
const LIST_B = '0f3a4b5c-2222-4222-8333-444455556666';

describe('loadIdListsForValues — URL q 의 list: 토큰만 골라 저장된 목록을 읽는다', () => {
  beforeEach(() => {
    state.rows = [];
    state.selectCalls = 0;
  });

  it('토큰이 없으면 DB 를 두드리지 않고 빈 맵', async () => {
    const map = await loadIdListsForValues(SURVEY_ID, ['1-30', '서울']);
    expect(map.size).toBe(0);
    expect(state.selectCalls).toBe(0);
  });

  it('토큰을 uuid 로 접어 한 번에 조회하고, 개수 접미사·대소문자는 무시한다', async () => {
    state.rows = [
      { id: LIST_A, ids: [7, 99] },
      { id: LIST_B, ids: [1] },
    ];
    const map = await loadIdListsForValues(SURVEY_ID, [
      `list:${LIST_A}:2`,
      `list:${LIST_A.toUpperCase()}`,
      `list:${LIST_B}`,
      '서울',
    ]);
    expect(state.selectCalls).toBe(1);
    expect(map.get(LIST_A)).toEqual([7, 99]);
    expect(map.get(LIST_B)).toEqual([1]);
  });

  it('단일 문자열 q 도 받는다', async () => {
    state.rows = [{ id: LIST_A, ids: [3] }];
    const map = await loadIdListsForValues(SURVEY_ID, `list:${LIST_A}`);
    expect(map.get(LIST_A)).toEqual([3]);
  });
});
