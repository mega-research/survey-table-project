/**
 * 버전 스냅샷 정리 — 원자성 계약 (2026-07-31 spec §5.4).
 * 계약: ① 스냅샷의 R2 키를 유예 큐에 등록한 뒤 ② snapshot 을 NULL 로 비우고
 *       ③ 그 버전의 파생 참조 인덱스 행을 지운다.
 * 세 작업이 모두 같은 executor(트랜잭션)에서 수행되어야 한다. ③ 이 빠지면
 * 정리된 버전이 인덱스로 참조를 계속 주장해, 방금 등록한 후보가 집행 시
 * '보존됨'(종결 상태)으로 닫히고 삭제가 영구히 막힌다.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SQL } from 'drizzle-orm';

const { registerMock } = vi.hoisted(() => ({
  registerMock: vi.fn<
    (
      dbc: unknown,
      input: { keys: string[]; source: string; reason?: string },
    ) => Promise<{ registered: number; rejectedKeys: string[] }>
  >(async () => ({ registered: 0, rejectedKeys: [] as string[] })),
}));

vi.mock('@/server/storage-lifecycle/deletion-queue.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/storage-lifecycle/deletion-queue.server')>()),
  registerDeletionCandidates: registerMock,
}));

import { pruneVersionSnapshots } from '@/server/survey-builder/services/versioning/version-prune.server';

const dialect = new PgDialect();

/** select → update → delete 를 흉내내는 최소 drizzle 스텁 */
function makeDbStub(rows: Array<{ id: string; snapshot: unknown }>) {
  const updated: Array<{ snapshot: null; prunedAt: Date }> = [];
  const deletedWhere: Array<{ sql: string; params: unknown[] }> = [];
  return {
    updated,
    deletedWhere,
    select: () => ({
      from: () => ({ where: async () => rows }),
    }),
    update: () => ({
      set: (values: { snapshot: null; prunedAt: Date }) => {
        updated.push(values);
        return { where: () => ({ returning: async () => rows.map((r) => ({ id: r.id })) }) };
      },
    }),
    delete: () => ({
      where: async (condition: unknown) => {
        const query = dialect.sqlToQuery(condition as SQL);
        deletedWhere.push({ sql: query.sql, params: query.params });
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  registerMock.mockResolvedValue({ registered: 0, rejectedKeys: [] });
});

describe('pruneVersionSnapshots', () => {
  it('스냅샷의 R2 키를 version-prune 수집원으로 등록한다', async () => {
    const db = makeDbStub([
      {
        id: 'v1',
        snapshot: {
          questions: [{ imageUrl: 'https://cdn-dev.megaresearch.co.kr/survey/2026/07/a.png' }],
        },
      },
    ]);

    const result = await pruneVersionSnapshots(
      db as never,
      ['v1'],
      '버전 보존 정책 정리',
    );

    expect(registerMock).toHaveBeenCalledTimes(1);
    const call = registerMock.mock.calls[0]?.[1] as {
      keys: string[];
      source: string;
    };
    expect(call.source).toBe('version-prune');
    expect(call.keys).toContain('survey/2026/07/a.png');
    expect(result.pruned).toBe(1);
  });

  it('키 등록이 snapshot 비우기보다 먼저 일어나고 인덱스 해제가 뒤따른다', async () => {
    const order: string[] = [];
    registerMock.mockImplementationOnce(async () => {
      order.push('register');
      return { registered: 1, rejectedKeys: [] };
    });
    const db = makeDbStub([
      {
        id: 'v1',
        snapshot: { imageUrl: 'https://cdn-dev.megaresearch.co.kr/survey/2026/07/a.png' },
      },
    ]);
    const originalUpdate = db.update;
    db.update = () => {
      order.push('update');
      return originalUpdate();
    };
    const originalDelete = db.delete;
    db.delete = () => {
      order.push('delete-key-refs');
      return originalDelete();
    };

    await pruneVersionSnapshots(db as never, ['v1'], '정리');

    expect(order).toEqual(['register', 'update', 'delete-key-refs']);
  });

  it('비운 버전의 파생 참조 인덱스 행을 같은 executor 에서 지운다', async () => {
    const db = makeDbStub([
      { id: 'v1', snapshot: { imageUrl: 'https://cdn-dev.megaresearch.co.kr/survey/a.png' } },
      { id: 'v2', snapshot: { imageUrl: 'https://cdn-dev.megaresearch.co.kr/survey/b.png' } },
    ]);

    await pruneVersionSnapshots(db as never, ['v1', 'v2'], '정리');

    expect(db.deletedWhere).toHaveLength(1);
    const [where] = db.deletedWhere;
    expect(where?.sql).toContain('"source_table"');
    expect(where?.sql).toContain('"source_id" in');
    expect(where?.params).toEqual(['survey_versions', 'v1', 'v2']);
  });

  it('대상이 없으면 아무것도 등록하지 않는다', async () => {
    const db = makeDbStub([]);

    const result = await pruneVersionSnapshots(db as never, ['v1'], '정리');

    expect(registerMock).not.toHaveBeenCalled();
    expect(result).toEqual({ pruned: 0, registeredKeys: 0 });
  });

  it('빈 목록은 조회조차 하지 않는다', async () => {
    const db = makeDbStub([]);
    const spy = vi.spyOn(db, 'select');

    const result = await pruneVersionSnapshots(db as never, [], '정리');

    expect(spy).not.toHaveBeenCalled();
    expect(result).toEqual({ pruned: 0, registeredKeys: 0 });
  });
});
