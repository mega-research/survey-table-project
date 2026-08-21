/**
 * 유예 삭제 집행자 — 결정 로직 통합 테스트 (이슈 07, R2/DB 협력자 mock).
 *
 * 계약: ① 장부 히트 → '보존됨'(삭제 미호출) ② 전역 참조 히트 → '보존됨'
 * ③ 통과 → 삭제+HEAD 검증 → '삭제됨' ④ 오류 → '실패'로 남아 재시도 대상
 * ⑤ step 커서 분할 — hasMore 소진까지 배치 반복, maxBatches 백스톱
 * ⑥ 배치 조회 이후 취소된 후보는 종결하지도 삭제하지도 않는다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { R2DeletionCandidate } from '@/db/schema';

const {
  fetchDueMock,
  resolveMock,
  resolvableMock,
  ledgerMock,
  referencedMock,
  deleteMock,
  indexedMock,
} = vi.hoisted(() => ({
  fetchDueMock: vi.fn<(limit: number, now?: Date) => Promise<R2DeletionCandidate[]>>(),
  resolveMock: vi.fn(async () => true),
  resolvableMock: vi.fn(async () => true),
  ledgerMock: vi.fn(async () => new Set<string>()),
  referencedMock: vi.fn(async () => new Set<string>()),
  deleteMock: vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: false; error: string }),
  indexedMock: vi.fn(async () => new Set<string>()),
}));

vi.mock('@/server/shared/r2-lifecycle/deletion-queue.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/shared/r2-lifecycle/deletion-queue.server')>()),
  fetchDueCandidates: fetchDueMock,
  resolveCandidate: resolveMock,
  isCandidateResolvable: resolvableMock,
}));
vi.mock('@/server/shared/r2-lifecycle/sent-ledger.server', () => ({
  getLedgeredKeys: ledgerMock,
  recordSentKeys: vi.fn(async () => 0),
}));
vi.mock('@/server/shared/r2-lifecycle/reference-scan.server', () => ({
  findReferencedKeys: referencedMock,
}));
vi.mock('@/server/shared/r2-lifecycle/r2-object-delete.server', () => ({
  deleteR2ObjectVerified: deleteMock,
}));
vi.mock('@/server/shared/r2-lifecycle/key-ref-index.server', () => ({
  getIndexedReferencedKeys: indexedMock,
}));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import {
  executeDueDeletionBatch,
  runDeletionExecutor,
} from '@/server/shared/r2-lifecycle/deletion-executor.server';

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
  indexedMock.mockResolvedValue(new Set());
  resolveMock.mockResolvedValue(true);
  resolvableMock.mockResolvedValue(true);
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

describe('executeDueDeletionBatch — 인덱스 사전 필터', () => {
  it('인덱스 히트 키는 스캔 없이 보존된다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'survey/2026/07/a.png')]);
    indexedMock.mockResolvedValueOnce(new Set(['survey/2026/07/a.png']));

    const result = await executeDueDeletionBatch(10);

    expect(result.keptIndexed).toBe(1);
    expect(referencedMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('인덱스 미스지만 스캔이 참조를 찾으면 보존하고 누락으로 집계한다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'survey/2026/07/a.png')]);
    indexedMock.mockResolvedValueOnce(new Set());
    referencedMock.mockResolvedValueOnce(new Set(['survey/2026/07/a.png']));

    const result = await executeDueDeletionBatch(10);

    expect(result.keptReferenced).toBe(1);
    expect(result.indexMisses).toBe(1);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('인덱스와 스캔 모두 미스면 삭제한다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'survey/2026/07/a.png')]);

    const result = await executeDueDeletionBatch(10);

    expect(result.deleted).toBe(1);
    expect(result.indexMisses).toBe(0);
    expect(deleteMock).toHaveBeenCalledWith('survey/2026/07/a.png');
  });

  it('장부 히트 키는 인덱스 조회 대상에서 빠진다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'mail/ledgered.png')]);
    ledgerMock.mockResolvedValueOnce(new Set(['mail/ledgered.png']));

    await executeDueDeletionBatch(10);

    expect(indexedMock).toHaveBeenCalledWith([]);
  });

  it('인덱스 조회가 실패해도 던지지 않고 전량 스캔으로 낮춰 배치를 계속한다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'survey/2026/07/a.png')]);
    indexedMock.mockRejectedValueOnce(new Error('r2_key_refs 조회 실패'));

    const result = await executeDueDeletionBatch(10);

    // 인덱스 실패는 스캔 실패가 아니다 — 삭제 권한이 없는 인덱스가 사라져도
    // 콘텐츠 스캔이 그대로 최종 판정을 내리므로 배치는 멈추지 않는다.
    expect(result.scanFailed).toBe(false);
    // 인덱스 없음 = 빈 결과 취급이므로 장부 통과분 전체가 스캔 대상이 된다.
    expect(referencedMock).toHaveBeenCalledWith(['survey/2026/07/a.png']);
    // 스캔이 참조를 못 찾은 키는 정상적으로 삭제까지 진행된다 — 정지하지 않는다.
    expect(result.deleted).toBe(1);
    expect(deleteMock).toHaveBeenCalledWith('survey/2026/07/a.png');
  });
});

describe('executeDueDeletionBatch — indexUnusable', () => {
  it('인덱스가 못 믿을 상태로 알려지면 조회를 건너뛰고 통과분 전량이 스캔에 닿는다', async () => {
    fetchDueMock.mockResolvedValueOnce([
      candidate('c1', 'survey/2026/07/a.png'),
      candidate('c2', 'survey/2026/07/b.png'),
    ]);

    const result = await executeDueDeletionBatch(10, new Date(), { indexUnusable: true });

    expect(indexedMock).not.toHaveBeenCalled();
    expect(referencedMock).toHaveBeenCalledWith([
      'survey/2026/07/a.png',
      'survey/2026/07/b.png',
    ]);
    expect(result.indexUnusable).toBe(true);
  });

  it('스캔이 찾지 못한 키는 인덱스 생략 경로에서도 삭제까지 진행된다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'survey/2026/07/a.png')]);

    const result = await executeDueDeletionBatch(10, new Date(), { indexUnusable: true });

    expect(result.deleted).toBe(1);
    expect(deleteMock).toHaveBeenCalledWith('survey/2026/07/a.png');
  });

  it('옵션을 안 주면 기본값대로 인덱스를 그대로 조회한다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'survey/2026/07/a.png')]);

    const result = await executeDueDeletionBatch(10);

    expect(indexedMock).toHaveBeenCalledWith(['survey/2026/07/a.png']);
    expect(result.indexUnusable).toBe(false);
  });
});

describe('runDeletionExecutor — indexUnusable 전달 및 취소 경합 알림', () => {
  const fakeStep = { run: <T,>(_id: string, fn: () => Promise<T>) => fn() };

  it('indexUnusable 옵션이 모든 배치에 그대로 전달된다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'survey/2026/07/a.png')]);

    const totals = await runDeletionExecutor(fakeStep, { indexUnusable: true });

    expect(indexedMock).not.toHaveBeenCalled();
    expect(totals.indexUnusableBatches).toBe(totals.batches);
  });

  it('skipped 가 0 보다 크면 run 이 끝날 때 Sentry warning 을 한 번 보낸다', async () => {
    const Sentry = await import('@sentry/nextjs');
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'survey/2026/07/a.png')]);
    resolvableMock.mockResolvedValueOnce(false);

    const totals = await runDeletionExecutor(fakeStep);

    expect(totals.skipped).toBe(1);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: 'warning',
        extra: expect.objectContaining({ skipped: 1 }),
      }),
    );
  });

  it('skipped 가 0 이면 Sentry warning 을 보내지 않는다', async () => {
    const Sentry = await import('@sentry/nextjs');
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'mail/gone.png')]);

    const totals = await runDeletionExecutor(fakeStep);

    expect(totals.skipped).toBe(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});

describe('executeDueDeletionBatch — 배치 조회 이후 상태 변경', () => {
  it('삭제 직전 취소된 후보는 R2 삭제도 종결도 하지 않는다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'survey/2026/07/a.png')]);
    // 배치 조회와 처리 사이에 부활 취소·관리자 취소가 들어온 상황
    resolvableMock.mockResolvedValueOnce(false);

    const result = await executeDueDeletionBatch(10);

    expect(deleteMock).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.deleted).toBe(0);
  });

  it('보존 판정 후보가 그 사이 취소되면 종결 실패를 건너뜀으로 집계한다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'mail/ledgered.png')]);
    ledgerMock.mockResolvedValueOnce(new Set(['mail/ledgered.png']));
    // 상태 가드에 막혀 0행 갱신
    resolveMock.mockResolvedValueOnce(false);

    const result = await executeDueDeletionBatch(10);

    expect(result.keptLedger).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('건너뛴 건수는 run 합계에 누적된다', async () => {
    fetchDueMock.mockResolvedValueOnce([candidate('c1', 'survey/2026/07/a.png')]);
    resolvableMock.mockResolvedValueOnce(false);

    const totals = await runDeletionExecutor({
      run: <T,>(_id: string, fn: () => Promise<T>) => fn(),
    });

    expect(totals.skipped).toBe(1);
    expect(totals.deleted).toBe(0);
  });
});
