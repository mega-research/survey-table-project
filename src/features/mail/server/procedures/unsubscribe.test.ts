import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/mail-unsubscribe.service', () => ({
  lookupContactByToken: vi.fn(),
  revertUnsubscribeByContactId: vi.fn(),
}));

import * as svc from '../services/mail-unsubscribe.service';
import { unsubscribe } from './unsubscribe';

function anonContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: { tag: 'anon-supabase' } as never,
    user: null,
    // rate limit 미들웨어가 신뢰 IP 를 추출하도록 정상 요청 헤더를 제공한다.
    headers: new Headers({ 'x-real-ip': '203.0.113.7' }),
  };
}

function authedContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: { id: 'admin-1', email: 'a@b.com' },
  };
}

const VALID_TOKEN = '11111111-2222-3333-4444-555555555555';
const VALID_CONTACT = '22222222-3333-4444-5555-666666666666';
const VALID_SURVEY = '33333333-4444-5555-6666-777777777777';

describe('mail.unsubscribe procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lookup(pub)은 익명 컨텍스트에서 컨택 조회 결과를 반환한다', async () => {
    vi.mocked(svc.lookupContactByToken).mockResolvedValue({
      ok: true,
      email: 'user@example.com',
      alreadyUnsubscribed: false,
    } as never);
    const client = createRouterClient({ unsubscribe }, { context: anonContext() });
    const res = await client.unsubscribe.lookup({ token: VALID_TOKEN });
    expect(svc.lookupContactByToken).toHaveBeenCalledWith({ token: VALID_TOKEN });
    expect(res).toEqual({
      ok: true,
      email: 'user@example.com',
      alreadyUnsubscribed: false,
    });
  });

  it('lookup 은 무효(비-UUID) 토큰도 input 검증을 통과시켜 service 에 위임한다', async () => {
    vi.mocked(svc.lookupContactByToken).mockResolvedValue({
      ok: false,
      email: null,
      alreadyUnsubscribed: false,
    } as never);
    const client = createRouterClient({ unsubscribe }, { context: anonContext() });
    const res = await client.unsubscribe.lookup({ token: 'not-a-uuid' });
    expect(svc.lookupContactByToken).toHaveBeenCalledWith({ token: 'not-a-uuid' });
    expect(res).toEqual({ ok: false, email: null, alreadyUnsubscribed: false });
  });

  it('revertByContactId 는 입력을 service 에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.revertUnsubscribeByContactId).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ unsubscribe }, { context: authedContext() });
    const input = { contactId: VALID_CONTACT, surveyId: VALID_SURVEY };
    const res = await client.unsubscribe.revertByContactId(input);
    expect(svc.revertUnsubscribeByContactId).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
  });

  it('revertByContactId 는 service 가 반환한 실패(error)를 그대로 통과시킨다', async () => {
    vi.mocked(svc.revertUnsubscribeByContactId).mockResolvedValue({
      ok: false,
      error: '대상 컨택을 찾을 수 없습니다.',
    } as never);
    const client = createRouterClient({ unsubscribe }, { context: authedContext() });
    const res = await client.unsubscribe.revertByContactId({
      contactId: VALID_CONTACT,
      surveyId: VALID_SURVEY,
    });
    expect(res).toEqual({ ok: false, error: '대상 컨택을 찾을 수 없습니다.' });
  });

  it('revertByContactId 는 인증 없으면 UNAUTHORIZED 로 막힌다', async () => {
    const client = createRouterClient({ unsubscribe }, { context: anonContext() });
    await expect(
      client.unsubscribe.revertByContactId({
        contactId: VALID_CONTACT,
        surveyId: VALID_SURVEY,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(svc.revertUnsubscribeByContactId).not.toHaveBeenCalled();
  });
});
