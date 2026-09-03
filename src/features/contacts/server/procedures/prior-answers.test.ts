import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-prior-answers.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../services/contact-prior-answers.service')>();
  return { ...actual, lookupPriorAnswers: vi.fn() };
});

import * as svc from '../services/contact-prior-answers.service';
import { priorAnswers } from './prior-answers';

function anonContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: { tag: 'anon-supabase' } as never,
    user: null,
    headers: new Headers({ 'x-real-ip': '203.0.113.7' }),
  };
}

const VALID_TOKEN = '11111111-2222-3333-4444-555555555555';

describe('contacts.priorAnswers procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lookup(pub)은 익명 컨텍스트에서 이월 응답을 반환한다', async () => {
    vi.mocked(svc.lookupPriorAnswers).mockResolvedValue({ q1: '창업' } as never);
    const client = createRouterClient({ priorAnswers }, { context: anonContext() });
    const res = await client.priorAnswers.lookup({
      surveyId: 's-1',
      inviteToken: VALID_TOKEN,
    });
    expect(svc.lookupPriorAnswers).toHaveBeenCalledWith({
      surveyId: 's-1',
      inviteToken: VALID_TOKEN,
    });
    expect(res).toEqual({ q1: '창업' });
  });

  it('lookup 은 이월 응답이 없으면 null 을 그대로 통과시킨다', async () => {
    vi.mocked(svc.lookupPriorAnswers).mockResolvedValue(null as never);
    const client = createRouterClient({ priorAnswers }, { context: anonContext() });
    expect(
      await client.priorAnswers.lookup({ surveyId: 's-1', inviteToken: VALID_TOKEN }),
    ).toBeNull();
  });

  it('lookup 은 무효(비-UUID) 토큰도 input 검증을 통과시켜 service 에 위임한다', async () => {
    vi.mocked(svc.lookupPriorAnswers).mockResolvedValue(null as never);
    const client = createRouterClient({ priorAnswers }, { context: anonContext() });
    await client.priorAnswers.lookup({ surveyId: 's-1', inviteToken: 'not-a-uuid' });
    expect(svc.lookupPriorAnswers).toHaveBeenCalledWith({
      surveyId: 's-1',
      inviteToken: 'not-a-uuid',
    });
  });
});
