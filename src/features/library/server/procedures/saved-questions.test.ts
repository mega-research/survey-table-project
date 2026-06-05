import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/saved-questions.service', () => ({
  listSavedQuestions: vi.fn(),
  searchSavedQuestions: vi.fn(),
  createSavedQuestion: vi.fn(),
  applySavedQuestion: vi.fn(),
}));

import * as svc from '../services/saved-questions.service';
import { savedQuestions } from './saved-questions';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

describe('savedQuestions procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list는 service.listSavedQuestions 결과를 반환한다', async () => {
    vi.mocked(svc.listSavedQuestions).mockResolvedValue([{ id: 'q1', name: '질문1' }] as never);
    const client = createRouterClient({ savedQuestions }, { context: authedContext() });
    const res = await client.savedQuestions.list();
    expect(svc.listSavedQuestions).toHaveBeenCalledOnce();
    expect(res[0]?.id).toBe('q1');
  });

  it('create는 입력을 service.createSavedQuestion에 위임한다', async () => {
    vi.mocked(svc.createSavedQuestion).mockResolvedValue({ id: 'new', name: '새질문' } as never);
    const client = createRouterClient({ savedQuestions }, { context: authedContext() });
    const input = { question: { id: 'x', type: 'text', title: 't', required: false, order: 0 }, metadata: { name: '새질문', category: '기본' } };
    const res = await client.savedQuestions.create(input as never);
    expect(svc.createSavedQuestion).toHaveBeenCalledWith(input);
    expect(res.id).toBe('new');
  });

  it('인증 없으면 list가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ savedQuestions }, { context: { db: {} as never, supabase: {} as never, user: null } });
    await expect(client.savedQuestions.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
