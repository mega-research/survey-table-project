import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_STORED_ID_LIST } from '@/lib/operations/range-list';

import { createContactIdList } from './contact-id-lists.service';

const captured: Array<Record<string, unknown>> = [];

vi.mock('@/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        captured.push(values);
        return { returning: async () => [{ id: '0f3a4b5c-1111-4222-8333-444455556666' }] };
      },
    })),
  },
}));

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';

describe('createContactIdList — 붙여넣은 ID 목록 저장', () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it('중복 제거·오름차순 정렬해 저장하고 id 와 개수를 돌려준다', async () => {
    const result = await createContactIdList({
      surveyId: SURVEY_ID,
      ids: [292, 99, 99, 235, 292],
      createdBy: 'admin-1',
    });

    expect(result).toEqual({ id: '0f3a4b5c-1111-4222-8333-444455556666', count: 3 });
    expect(captured).toEqual([
      { surveyId: SURVEY_ID, ids: [99, 235, 292], idCount: 3, createdBy: 'admin-1' },
    ]);
  });

  it('1 미만·정수 아닌 값은 버린다 — 전부 버려지면 저장하지 않고 거부', async () => {
    await expect(
      createContactIdList({ surveyId: SURVEY_ID, ids: [0, -1, 1.5], createdBy: null }),
    ).rejects.toThrow('저장할 ID 가 없습니다.');
    expect(captured).toEqual([]);
  });

  it('저장 상한(MAX_STORED_ID_LIST)을 넘으면 거부', async () => {
    const ids = Array.from({ length: MAX_STORED_ID_LIST + 1 }, (_, i) => i + 1);
    await expect(
      createContactIdList({ surveyId: SURVEY_ID, ids, createdBy: null }),
    ).rejects.toThrow('개까지');
    expect(captured).toEqual([]);
  });
});
