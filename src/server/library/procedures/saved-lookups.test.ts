import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/saved-lookups.service', () => ({
  listSavedLookups: vi.fn(),
  createSavedLookup: vi.fn(),
  updateSavedLookup: vi.fn(),
  deleteSavedLookup: vi.fn(),
}));

import * as svc from '../services/saved-lookups.service';
import { savedLookups } from './saved-lookups';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

describe('savedLookups procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list는 service.listSavedLookups 결과를 반환한다', async () => {
    vi.mocked(svc.listSavedLookups).mockResolvedValue([{ id: 'l1', name: 'LUT1' }] as never);
    const client = createRouterClient({ savedLookups }, { context: authedContext() });
    const res = await client.savedLookups.list();
    expect(svc.listSavedLookups).toHaveBeenCalledOnce();
    expect(res[0]?.id).toBe('l1');
  });

  it('create는 입력을 service.createSavedLookup에 위임한다', async () => {
    vi.mocked(svc.createSavedLookup).mockResolvedValue({ id: 'new', name: '새LUT' } as never);
    const client = createRouterClient({ savedLookups }, { context: authedContext() });
    const input = {
      name: '새LUT',
      category: 'custom',
      tags: [],
      columns: ['키'],
      rows: [{ 키: 'v' }],
    };
    const res = await client.savedLookups.create(input as never);
    expect(svc.createSavedLookup).toHaveBeenCalledWith({ ...input });
    expect(res.id).toBe('new');
  });

  it('인증 없으면 list가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { savedLookups },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(client.savedLookups.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
