import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactResultCode } from '@/shared/contracts/contacts';
import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-result-codes', () => ({
  updateResultCodes: vi.fn(),
}));

import * as svc from '../services/contact-result-codes';
import { resultCodes } from './result-codes';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

describe('resultCodes procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('update는 surveyId와 codes를 service.updateResultCodes에 위임한다', async () => {
    vi.mocked(svc.updateResultCodes).mockResolvedValue(undefined as never);
    const client = createRouterClient({ contacts: { resultCodes } }, { context: authedContext() });
    const codes: ContactResultCode[] = [
      { code: '1.조사완료', label: '1.조사완료', order: 1, tone: 'green', status: 'positive' },
    ];
    const res = await client.contacts.resultCodes.update({ surveyId: 's-1', codes });
    expect(svc.updateResultCodes).toHaveBeenCalledWith('s-1', codes);
    expect(res).toEqual({ ok: true });
  });

  it('update는 codes=null(기본 코드셋 복귀)도 그대로 전달한다', async () => {
    vi.mocked(svc.updateResultCodes).mockResolvedValue(undefined as never);
    const client = createRouterClient({ contacts: { resultCodes } }, { context: authedContext() });
    const res = await client.contacts.resultCodes.update({ surveyId: 's-1', codes: null });
    expect(svc.updateResultCodes).toHaveBeenCalledWith('s-1', null);
    expect(res).toEqual({ ok: true });
  });

  it('service throw(빈 배열 reject 등)는 그대로 전파된다', async () => {
    vi.mocked(svc.updateResultCodes).mockRejectedValue(
      new Error('결과코드는 최소 1개 이상이어야 합니다.') as never,
    );
    const client = createRouterClient({ contacts: { resultCodes } }, { context: authedContext() });
    await expect(
      client.contacts.resultCodes.update({ surveyId: 's-1', codes: [] }),
    ).rejects.toThrow('결과코드는 최소 1개 이상이어야 합니다.');
  });

  it('인증 없으면 update가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { contacts: { resultCodes } },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.contacts.resultCodes.update({ surveyId: 's-1', codes: null }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
