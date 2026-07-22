import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createRouterClient, type RouterClient } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-attrs.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/contact-attrs.service')>();
  return { ...actual, lookupContactAttrs: vi.fn() };
});

import * as svc from '../services/contact-attrs.service';
import { attrs } from './attrs';

function anonContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: { tag: 'anon-supabase' } as never,
    user: null,
    // rate limit 미들웨어가 신뢰 IP 를 추출하도록 정상 요청 헤더를 제공한다.
    headers: new Headers({ 'x-real-ip': '203.0.113.7' }),
  };
}

const VALID_TOKEN = '11111111-2222-3333-4444-555555555555';

function rpcBoundaryClient(): RouterClient<{ attrs: typeof attrs }> {
  const handler = new RPCHandler({ attrs });
  const link = new RPCLink({
    url: 'http://localhost/api/rpc',
    fetch: async (request) => {
      const { response } = await handler.handle(request, {
        prefix: '/api/rpc',
        context: anonContext(),
      });
      if (!response) throw new Error('RPC 응답이 없습니다.');
      return response;
    },
  });
  return createORPCClient(link);
}

describe('contacts.attrs procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lookup(pub)은 익명 컨텍스트에서 attrs 를 반환한다', async () => {
    vi.mocked(svc.lookupContactAttrs).mockResolvedValue({ name: '홍길동' } as never);
    const client = createRouterClient({ attrs }, { context: anonContext() });
    const res = await client.attrs.lookup({ surveyId: 's-1', inviteToken: VALID_TOKEN });
    expect(svc.lookupContactAttrs).toHaveBeenCalledWith({
      surveyId: 's-1',
      inviteToken: VALID_TOKEN,
    });
    expect(res).toEqual({ name: '홍길동' });
  });

  it('lookup 은 매칭 실패 시 service 가 반환한 null 을 그대로 통과시킨다', async () => {
    vi.mocked(svc.lookupContactAttrs).mockResolvedValue(null as never);
    const client = createRouterClient({ attrs }, { context: anonContext() });
    const res = await client.attrs.lookup({ surveyId: 's-1', inviteToken: VALID_TOKEN });
    expect(res).toBeNull();
  });

  it('lookup 은 무효(비-UUID) 토큰도 input 검증을 통과시켜 service 에 위임한다', async () => {
    vi.mocked(svc.lookupContactAttrs).mockResolvedValue(null as never);
    const client = createRouterClient({ attrs }, { context: anonContext() });
    const res = await client.attrs.lookup({ surveyId: 's-1', inviteToken: 'not-a-uuid' });
    expect(svc.lookupContactAttrs).toHaveBeenCalledWith({
      surveyId: 's-1',
      inviteToken: 'not-a-uuid',
    });
    expect(res).toBeNull();
  });

  it('INVALID_TEST_LINK를 실제 RPC 경계 넘어서도 typed error로 보존한다', async () => {
    vi.mocked(svc.lookupContactAttrs).mockRejectedValue(new svc.InvalidTestLinkError());

    await expect(
      rpcBoundaryClient().attrs.lookup({ surveyId: 's-1', inviteToken: VALID_TOKEN }),
    ).rejects.toMatchObject({
      defined: true,
      code: 'INVALID_TEST_LINK',
    });
  });
});
