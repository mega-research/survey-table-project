import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { R2DeletionCandidate } from '@/db/schema';
import type { ORPCContext } from '@/server/context';

vi.mock('../services/file-cleanup', () => ({
  listPending: vi.fn(),
  listHistory: vi.fn(),
  cancel: vi.fn(),
}));

import * as svc from '../services/file-cleanup';
import { fileCleanup } from './file-cleanup';

function authedContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: { id: 'admin-1', email: 'a@b.com' },
  };
}

function anonContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: null };
}

function candidateRow(overrides: Partial<R2DeletionCandidate> = {}): R2DeletionCandidate {
  return {
    id: '2b6e9d1c-3f4a-4b5c-8d6e-7f8a9b0c1d2e',
    key: 'survey/abc123.webp',
    source: 'survey-delete',
    reason: '설문 삭제: sv-1',
    status: 'pending',
    registeredAt: new Date('2026-07-01T00:00:00Z'),
    executeAfter: new Date('2026-07-08T00:00:00Z'),
    resolvedAt: null,
    resultNote: null,
    ...overrides,
  };
}

describe('media fileCleanup procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('listPending은 입력을 service.listPending에 위임한다', async () => {
    vi.mocked(svc.listPending).mockResolvedValue([candidateRow()]);
    const client = createRouterClient({ fileCleanup }, { context: authedContext() });
    const res = await client.fileCleanup.listPending({ limit: 50 });
    expect(svc.listPending).toHaveBeenCalledWith({ limit: 50 });
    expect(res).toHaveLength(1);
    expect(res[0]?.key).toBe('survey/abc123.webp');
    expect(res[0]?.status).toBe('pending');
  });

  it('listPending은 입력 없이 호출하면 undefined를 위임한다', async () => {
    vi.mocked(svc.listPending).mockResolvedValue([]);
    const client = createRouterClient({ fileCleanup }, { context: authedContext() });
    const res = await client.fileCleanup.listPending();
    expect(svc.listPending).toHaveBeenCalledWith(undefined);
    expect(res).toEqual([]);
  });

  it('listHistory는 status 필터를 service.listHistory에 위임한다', async () => {
    vi.mocked(svc.listHistory).mockResolvedValue([
      candidateRow({
        status: 'deleted',
        resolvedAt: new Date('2026-07-09T00:00:00Z'),
        resultNote: '집행 완료',
      }),
    ]);
    const client = createRouterClient({ fileCleanup }, { context: authedContext() });
    const res = await client.fileCleanup.listHistory({ status: 'deleted' });
    expect(svc.listHistory).toHaveBeenCalledWith({ status: 'deleted' });
    expect(res[0]?.status).toBe('deleted');
    expect(res[0]?.resultNote).toBe('집행 완료');
  });

  it('listHistory는 pending을 status 필터로 받지 않는다 (input 검증)', async () => {
    const client = createRouterClient({ fileCleanup }, { context: authedContext() });
    await expect(
      client.fileCleanup.listHistory({ status: 'pending' as never }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.listHistory).not.toHaveBeenCalled();
  });

  it('cancel은 id를 service.cancel에 위임하고 boolean을 반환한다', async () => {
    vi.mocked(svc.cancel).mockResolvedValue(true);
    const client = createRouterClient({ fileCleanup }, { context: authedContext() });
    const input = { id: '2b6e9d1c-3f4a-4b5c-8d6e-7f8a9b0c1d2e' };
    const res = await client.fileCleanup.cancel(input);
    expect(svc.cancel).toHaveBeenCalledWith(input);
    expect(res).toBe(true);
  });

  it('cancel은 UUID가 아닌 id를 input 검증에서 막는다', async () => {
    const client = createRouterClient({ fileCleanup }, { context: authedContext() });
    await expect(
      client.fileCleanup.cancel({ id: 'not-a-uuid' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.cancel).not.toHaveBeenCalled();
  });

  it('인증 없으면 listPending이 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ fileCleanup }, { context: anonContext() });
    await expect(client.fileCleanup.listPending()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(svc.listPending).not.toHaveBeenCalled();
  });

  it('게스트 grant 보유자는 cancel이 FORBIDDEN으로 막힌다 (admin 전용 표면)', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:sv-1');
    const client = createRouterClient(
      { fileCleanup },
      {
        context: {
          db: {} as never,
          supabase: {} as never,
          user: { id: 'guest-1', email: 'g@b.com' },
        },
      },
    );
    await expect(
      client.fileCleanup.cancel({ id: '2b6e9d1c-3f4a-4b5c-8d6e-7f8a9b0c1d2e' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.cancel).not.toHaveBeenCalled();
  });
});
