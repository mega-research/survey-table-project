/**
 * 유예 삭제 집행자 — 결정 로직 통합 테스트 (이슈 07, R2/DB 협력자 mock).
 *
 * 계약: ① 장부 히트 → '보존됨'(삭제 미호출) ② 전역 참조 히트 → '보존됨'
 * ③ 통과 → 삭제+HEAD 검증 → '삭제됨' ④ 오류 → '실패'로 남아 재시도 대상
 * ⑤ step 커서 분할 — hasMore 소진까지 배치 반복, maxBatches 백스톱.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { R2DeletionCandidate } from '@/db/schema';

const { fetchDueMock, resolveMock, ledgerMock, referencedMock, deleteMock } = vi.hoisted(() => ({
  fetchDueMock: vi.fn<(limit: number, now?: Date) => Promise<R2DeletionCandidate[]>>(),
  resolveMock: vi.fn(async () => undefined),
  ledgerMock: vi.fn(async () => new Set<string>()),
  referencedMock: vi.fn(async () => new Set<string>()),
  deleteMock: vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: false; error: string }),
}));

vi.mock('@/lib/r2-lifecycle/deletion-queue.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/r2-lifecycle/deletion-queue.server')>()),
  fetchDueCandidates: fetchDueMock,
  resolveCandidate: resolveMock,
}));
vi.mock('@/lib/r2-lifecycle/sent-ledger.server', () => ({
  getLedgeredKeys: ledgerMock,
  recordSentKeys: vi.fn(async () => 0),
}));
vi.mock('@/lib/r2-lifecycle/reference-scan.server', () => ({
  findReferencedKeys: referencedMock,
}));
vi.mock('@/lib/r2-lifecycle/r2-object-delete.server', () => ({
  deleteR2ObjectVerified: deleteMock,
}));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import {
  executeDueDeletionBatch,
  runDeletionExecutor,
} from '@/lib/r2-lifecycle/deletion-executor.server';

function candidate(id: string, key: string): R2DeletionCandidate {
  return {
    id,
    key,
    source: 'save-diff',
    reason: null,
    status: 'pending',
    registeredAt: new Date('2026-07-20T00:00:00Z'),
    executeAfter: new Date('2026-07-27T00:00:00Z'),
    resolvedAt: null,
    resultNote: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ledgerMock.mockResolvedValue(new Set());
  referencedMock.mockResolvedValue(new Set());
  deleteMock.mockResolvedValue({ ok: true });
});

describe('executeDueDeletionBatch — 키별 결정', () => {
  it('장부 히트 키는 삭제 없이 보존됨으로 종결된다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'mail/ledgered.png')]);
    ledgerMock.mockResolvedValueOnce(new Set(['mail/ledgered.png']));

    const result = await executeDueDeletionBatch(10);

    expect(result.keptLedger).toBe(1);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(resolveMock).toHaveBeenCalledWith('c1', 'kept', expect.stringContaining('발송 장부'));
    // 장부 히트 키는 전역 재확인 스캔 대상에서도 제외된다
    expect(referencedMock).not.toHaveBeenCalled();
  });

  it('전역 참조 히트 키는 삭제 없이 보존됨으로 종결된다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c2', 'survey/referenced.png')]);
    referencedMock.mockResolvedValueOnce(new Set(['survey/referenced.png']));

    const result = await executeDueDeletionBatch(10);

    expect(result.keptReferenced).toBe(1);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(resolveMock).toHaveBeenCalledWith('c2', 'kept', expect.stringContaining('참조'));
  });

  it('통과 키는 삭제 + HEAD 검증 후 삭제됨으로 기록된다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c3', 'mail/gone.png')]);

    const result = await executeDueDeletionBatch(10);

    expect(result.deleted).toBe(1);
    expect(deleteMock).toHaveBeenCalledWith('mail/gone.png');
    expect(resolveMock).toHaveBeenCalledWith('c3', 'deleted', expect.stringContaining('HEAD'));
  });

  it('삭제 오류는 실패로 기록되어 다음 집행의 재시도 대상으로 남는다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c4', 'mail/stuck.png')]);
    deleteMock.mockResolvedValueOnce({ ok: false, error: 'HEAD 검증 실패: 삭제 후에도 객체가 존재' });

    const result = await executeDueDeletionBatch(10);

    expect(result.failed).toBe(1);
    expect(resolveMock).toHaveBeenCalledWith('c4', 'failed', expect.stringContaining('HEAD'));
  });

  it('혼합 배치에서 각 키가 독립적으로 판정된다', async () => {
    fetchDueMock.mockResolvedValueOnce([
      candidate('c5', 'mail/ledgered.png'),
      candidate('c6', 'survey/referenced.png'),
      candidate('c7', 'mail/gone.png'),
    ]);
    ledgerMock.mockResolvedValueOnce(new Set(['mail/ledgered.png']));
    referencedMock.mockResolvedValueOnce(new Set(['survey/referenced.png']));

    const result = await executeDueDeletionBatch(10);

    expect(result).toMatchObject({ keptLedger: 1, keptReferenced: 1, deleted: 1, failed: 0 });
    // 장부 히트 키는 재확인 스캔 입력에서 빠진다
    expect(referencedMock).toHaveBeenCalledWith(['survey/referenced.png', 'mail/gone.png']);
  });
});

describe('runDeletionExecutor — step 커서 분할', () => {
  const fakeStep = { run: <T,>(_id: string, fn: () => Promise<T>) => fn() };

  it('hasMore 가 꺼질 때까지 배치를 반복하고 합계를 집계한다', async () => {
    fetchDueMock
      .mockResolvedValueOnce([candidate('b1', 'mail/a.png'), candidate('b2', 'mail/b.png')])
      .mockResolvedValueOnce([candidate('b3', 'mail/c.png')]);

    const totals = await runDeletionExecutor(fakeStep, { batchSize: 2 });

    expect(totals.batches).toBe(2);
    expect(totals.processed).toBe(3);
    expect(totals.deleted).toBe(3);
  });

  it('maxBatches 백스톱을 넘지 않는다', async () => {
    fetchDueMock.mockResolvedValue([candidate('x', 'mail/x.png'), candidate('y', 'mail/y.png')]);

    const totals = await runDeletionExecutor(fakeStep, { batchSize: 2, maxBatches: 3 });

    expect(totals.batches).toBe(3);
    expect(fetchDueMock).toHaveBeenCalledTimes(3);
  });
});

describe('executeDueDeletionBatch — 스캔 실패 처리', () => {
  it('참조 재확인이 실패하면 후보를 종결하지 않고 배치를 보류한다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'mail/a.png')]);
    referencedMock.mockRejectedValueOnce(
      new Error('canceling statement due to statement timeout'),
    );

    const result = await executeDueDeletionBatch(10);

    expect(result.scanFailed).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('스캔이 실패해도 장부 히트 키를 삭제하지 않는다', async () => {
    fetchDueMock.mockResolvedValueOnce([
      candidate('c1', 'mail/ledgered.png'),
      candidate('c2', 'mail/other.png'),
    ]);
    ledgerMock.mockResolvedValueOnce(new Set(['mail/ledgered.png']));
    referencedMock.mockRejectedValueOnce(new Error('scan boom'));

    const result = await executeDueDeletionBatch(10);

    expect(result.scanFailed).toBe(true);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('스캔 실패 배치를 만나면 runDeletionExecutor 가 루프를 멈추고 집계한다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'mail/a.png')]);
    referencedMock.mockRejectedValueOnce(new Error('scan boom'));

    const step = { run: (_id: string, fn: () => Promise<never>) => fn() };
    const totals = await runDeletionExecutor(
      step as unknown as Parameters<typeof runDeletionExecutor>[0],
    );

    expect(totals.scanFailures).toBe(1);
    expect(totals.batches).toBe(1);
  });
});
