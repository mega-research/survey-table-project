import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/question-categories.service', () => ({
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  initializeDefaultCategories: vi.fn(),
}));

import * as svc from '../services/question-categories.service';
import { questionCategories } from './question-categories';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

describe('questionCategories procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list는 service.listCategories 결과를 반환한다', async () => {
    vi.mocked(svc.listCategories).mockResolvedValue([
      { id: 'c1', name: '인구통계', color: 'bg-blue-100', order: 0 },
    ] as never);
    const client = createRouterClient({ questionCategories }, { context: authedContext() });
    const res = await client.questionCategories.list();
    expect(svc.listCategories).toHaveBeenCalledOnce();
    expect(res[0]?.id).toBe('c1');
  });

  it('create는 입력을 service.createCategory에 위임한다', async () => {
    vi.mocked(svc.createCategory).mockResolvedValue({
      id: 'new',
      name: '새카테고리',
      color: 'bg-gray-100 text-gray-600',
      order: 6,
    } as never);
    const client = createRouterClient({ questionCategories }, { context: authedContext() });
    const input = { name: '새카테고리' };
    const res = await client.questionCategories.create(input);
    expect(svc.createCategory).toHaveBeenCalledWith(input);
    expect(res.id).toBe('new');
  });

  it('update는 id와 updates를 service.updateCategory에 위임한다', async () => {
    vi.mocked(svc.updateCategory).mockResolvedValue({
      id: 'c1',
      name: '수정됨',
      color: 'bg-blue-100',
      order: 0,
    } as never);
    const client = createRouterClient({ questionCategories }, { context: authedContext() });
    const res = await client.questionCategories.update({ id: 'c1', updates: { name: '수정됨' } });
    expect(svc.updateCategory).toHaveBeenCalledWith('c1', { name: '수정됨' });
    expect(res.name).toBe('수정됨');
  });

  it('인증 없으면 list가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { questionCategories },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(client.questionCategories.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
