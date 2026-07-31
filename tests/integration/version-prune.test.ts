/**
 * 버전 스냅샷 정리 — 원자성 계약 (2026-07-31 spec §5.4).
 * 계약: ① 스냅샷의 R2 키를 유예 큐에 등록한 뒤 ② snapshot 을 NULL 로 비운다.
 * 두 작업이 같은 executor(트랜잭션)에서 수행되어야 한다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { registerMock } = vi.hoisted(() => ({
  registerMock: vi.fn<
    (
      dbc: unknown,
      input: { keys: string[]; source: string; reason?: string },
    ) => Promise<{ registered: number; rejectedKeys: string[] }>
  >(async () => ({ registered: 0, rejectedKeys: [] as string[] })),
}));

vi.mock('@/lib/r2-lifecycle/deletion-queue.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/r2-lifecycle/deletion-queue.server')>()),
  registerDeletionCandidates: registerMock,
}));

import { pruneVersionSnapshots } from '@/lib/versioning/version-prune.server';

/** select → update 를 흉내내는 최소 drizzle 스텁 */
function makeDbStub(rows: Array<{ id: string; snapshot: unknown }>) {
  const updated: Array<{ snapshot: null; prunedAt: Date }> = [];
  return {
    updated,
    select: () => ({
      from: () => ({ where: async () => rows }),
    }),
    update: () => ({
      set: (values: { snapshot: null; prunedAt: Date }) => {
        updated.push(values);
        return { where: () => ({ returning: async () => rows.map((r) => ({ id: r.id })) }) };
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

  it('키 등록이 snapshot 비우기보다 먼저 일어난다', async () => {
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

    await pruneVersionSnapshots(db as never, ['v1'], '정리');

    expect(order).toEqual(['register', 'update']);
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
