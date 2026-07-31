/**
 * 파생 참조 인덱스 — 기록·조회 계약 (2026-07-31 spec §6.2).
 * 계약: ① 기록은 해당 source row 의 참조를 통째로 교체한다
 *       ② 게이트 불통과 키는 기록하지 않는다 (key-extract 와 동일 의미론)
 *       ③ 조회는 주어진 키 중 인덱스에 있는 것만 반환한다
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteMock, insertMock, selectRowsMock } = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  insertMock: vi.fn(),
  selectRowsMock: vi.fn(async () => [] as Array<{ key: string }>),
}));

vi.mock('@/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: selectRowsMock }) }),
  },
}));

import {
  getIndexedReferencedKeys,
  recordKeyRefs,
} from '@/lib/r2-lifecycle/key-ref-index.server';

function makeDbStub() {
  const inserted: Array<{ key: string; sourceTable: string; sourceId: string }> = [];
  return {
    inserted,
    delete: () => {
      deleteMock();
      return { where: async () => undefined };
    },
    insert: () => ({
      values: (rows: Array<{ key: string; sourceTable: string; sourceId: string }>) => {
        insertMock();
        inserted.push(...rows);
        return {
          onConflictDoNothing: () => ({
            returning: async () => rows.map((r) => ({ key: r.key })),
          }),
        };
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectRowsMock.mockResolvedValue([]);
});

describe('recordKeyRefs', () => {
  it('기록 전에 해당 source row 의 기존 참조를 지운다', async () => {
    const db = makeDbStub();

    await recordKeyRefs(db as never, 'survey_versions', 'v1', ['survey/2026/07/a.png']);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({
      key: 'survey/2026/07/a.png',
      sourceTable: 'survey_versions',
      sourceId: 'v1',
    });
  });

  it('게이트 불통과 키는 기록하지 않는다', async () => {
    const db = makeDbStub();

    const recorded = await recordKeyRefs(db as never, 'survey_versions', 'v1', [
      'tmp/should-not-be-indexed.png',
      'images/legacy.png',
    ]);

    expect(recorded).toBe(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('키가 없어도 기존 참조는 지운다', async () => {
    const db = makeDbStub();

    await recordKeyRefs(db as never, 'survey_versions', 'v1', []);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe('getIndexedReferencedKeys', () => {
  it('인덱스에 있는 키만 반환한다', async () => {
    selectRowsMock.mockResolvedValueOnce([{ key: 'survey/2026/07/a.png' }]);

    const result = await getIndexedReferencedKeys([
      'survey/2026/07/a.png',
      'survey/2026/07/b.png',
    ]);

    expect(result).toEqual(new Set(['survey/2026/07/a.png']));
  });

  it('빈 입력은 조회하지 않는다', async () => {
    const result = await getIndexedReferencedKeys([]);

    expect(result.size).toBe(0);
    expect(selectRowsMock).not.toHaveBeenCalled();
  });
});
