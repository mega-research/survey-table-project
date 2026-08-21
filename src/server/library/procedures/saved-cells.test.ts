import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/saved-cells.service', () => ({
  listSavedCells: vi.fn(),
  searchSavedCells: vi.fn(),
  createSavedCell: vi.fn(),
  deleteSavedCell: vi.fn(),
  applySavedCell: vi.fn(),
}));

import * as svc from '../services/saved-cells.service';
import { savedCells } from './saved-cells';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

describe('savedCells procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list는 service.listSavedCells 결과를 반환한다', async () => {
    vi.mocked(svc.listSavedCells).mockResolvedValue([{ id: 'c1', name: '셀1' }] as never);
    const client = createRouterClient({ savedCells }, { context: authedContext() });
    const res = await client.savedCells.list();
    expect(svc.listSavedCells).toHaveBeenCalledOnce();
    expect(res[0]?.id).toBe('c1');
  });

  it('create는 입력을 service.createSavedCell에 위임한다', async () => {
    vi.mocked(svc.createSavedCell).mockResolvedValue({ id: 'new', name: '새셀' } as never);
    const client = createRouterClient({ savedCells }, { context: authedContext() });
    const input = { cell: { id: 'x', type: 'text', content: '내용' }, name: '새셀' };
    const res = await client.savedCells.create(input as never);
    expect(svc.createSavedCell).toHaveBeenCalledWith(input);
    expect(res.id).toBe('new');
  });

  it('인증 없으면 list가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { savedCells },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(client.savedCells.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
