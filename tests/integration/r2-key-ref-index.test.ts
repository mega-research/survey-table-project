/**
 * 파생 참조 인덱스 — 기록·해제·조회 계약 (2026-07-31 spec §6.2).
 * 계약: ① 기록은 해당 source row 의 참조를 통째로 교체한다
 *       ② 게이트 불통과 키는 기록하지 않는다 (key-extract 와 동일 의미론)
 *       ③ 조회는 주어진 키 중 인덱스에 있는 것만 반환한다
 *       ④ 소멸한 source row 의 참조는 (source_table, source_id) 로 좁혀 지운다
 *
 * delete 의 where 절은 호출 횟수가 아니라 **생성된 SQL** 로 검증한다 — 스코프
 * 회귀(테이블 전체 삭제·잘못된 컬럼)를 횟수만으로는 못 잡는다.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SQL } from 'drizzle-orm';

const { deleteMock, insertMock, selectRowsMock, whereArgs } = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  insertMock: vi.fn(),
  selectRowsMock: vi.fn(async () => [] as Array<{ key: string }>),
  whereArgs: [] as unknown[],
}));

vi.mock('@/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: selectRowsMock }) }),
  },
}));

import {
  deleteKeyRefsBySourceIds,
  getIndexedReferencedKeys,
  recordKeyRefs,
} from '@/server/shared/r2-lifecycle/key-ref-index.server';

const dialect = new PgDialect();

/** delete().where() 에 넘어간 drizzle 표현식을 실제 SQL 로 렌더한다. */
function renderedWhere(index = 0): { sql: string; params: unknown[] } {
  const arg = whereArgs[index];
  if (!arg) throw new Error('where 인자가 캡처되지 않았다');
  const query = dialect.sqlToQuery(arg as SQL);
  return { sql: query.sql, params: query.params };
}

function makeDbStub() {
  const inserted: Array<{ key: string; sourceTable: string; sourceId: string }> = [];
  return {
    inserted,
    delete: () => {
      deleteMock();
      return {
        where: async (condition: unknown) => {
          whereArgs.push(condition);
        },
      };
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
  whereArgs.length = 0;
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

  it('삭제 범위를 해당 (source_table, source_id) 한 쌍으로 좁힌다', async () => {
    const db = makeDbStub();

    await recordKeyRefs(db as never, 'survey_versions', 'v1', ['survey/2026/07/a.png']);

    const { sql, params } = renderedWhere();
    expect(sql).toContain('"source_table"');
    expect(sql).toContain('"source_id"');
    expect(sql).toMatch(/\band\b/i);
    expect(params).toEqual(['survey_versions', 'v1']);
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

describe('deleteKeyRefsBySourceIds', () => {
  it('주어진 source id 들의 참조만 지운다', async () => {
    const db = makeDbStub();

    await deleteKeyRefsBySourceIds(db as never, 'survey_versions', ['v1', 'v2']);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    const { sql, params } = renderedWhere();
    expect(sql).toContain('"source_table"');
    expect(sql).toContain('"source_id" in');
    expect(params).toEqual(['survey_versions', 'v1', 'v2']);
  });

  it('빈 목록이면 아무것도 지우지 않는다', async () => {
    const db = makeDbStub();

    await deleteKeyRefsBySourceIds(db as never, 'survey_versions', []);

    expect(deleteMock).not.toHaveBeenCalled();
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
