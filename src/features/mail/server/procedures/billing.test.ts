import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/mail-billing.service', () => ({
  createBillingPeriod: vi.fn(),
  deleteLatestBillingPeriod: vi.fn(),
}));

import * as svc from '../services/mail-billing.service';
import { billing } from './billing';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const validCreateInput = {
  startDate: '2026-06-01',
  planLabel: 'Pro 50K',
  monthlyFeeKrw: 28600,
  includedEmails: 50000,
  overagePer1kKrw: 1290,
};

describe('billing procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create는 input과 user.id를 service.createBillingPeriod에 위임하고 ok를 반환한다', async () => {
    vi.mocked(svc.createBillingPeriod).mockResolvedValue(undefined as never);
    const client = createRouterClient({ mail: { billing } }, { context: authedContext() });
    const res = await client.mail.billing.create(validCreateInput);
    expect(svc.createBillingPeriod).toHaveBeenCalledWith(validCreateInput, 'admin-1');
    expect(res).toEqual({ ok: true });
  });

  it('create는 service throw(day 범위/unique 변환 메시지)를 그대로 전파한다', async () => {
    vi.mocked(svc.createBillingPeriod).mockRejectedValue(
      new Error('동일한 시작일의 요금제가 이미 등록되어 있습니다.') as never,
    );
    const client = createRouterClient({ mail: { billing } }, { context: authedContext() });
    await expect(client.mail.billing.create(validCreateInput)).rejects.toThrow(
      '동일한 시작일의 요금제가 이미 등록되어 있습니다.',
    );
  });

  it('deleteLatest는 id를 service.deleteLatestBillingPeriod에 위임하고 ok를 반환한다', async () => {
    vi.mocked(svc.deleteLatestBillingPeriod).mockResolvedValue(undefined as never);
    const client = createRouterClient({ mail: { billing } }, { context: authedContext() });
    const res = await client.mail.billing.deleteLatest({
      id: '7231b5bc-c40e-4605-92cc-b4ded7afeff8',
    });
    expect(svc.deleteLatestBillingPeriod).toHaveBeenCalledWith(
      '7231b5bc-c40e-4605-92cc-b4ded7afeff8',
    );
    expect(res).toEqual({ ok: true });
  });

  it('deleteLatest는 service throw(더 최근 행 존재 등)를 그대로 전파한다', async () => {
    vi.mocked(svc.deleteLatestBillingPeriod).mockRejectedValue(
      new Error('더 최근의 요금제가 존재합니다. 가장 최근 행부터 차례로 삭제해주세요.') as never,
    );
    const client = createRouterClient({ mail: { billing } }, { context: authedContext() });
    await expect(
      client.mail.billing.deleteLatest({ id: '7231b5bc-c40e-4605-92cc-b4ded7afeff8' }),
    ).rejects.toThrow('더 최근의 요금제가 존재합니다');
  });

  it('인증 없으면 create가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { mail: { billing } },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(client.mail.billing.create(validCreateInput)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('인증 없으면 deleteLatest가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { mail: { billing } },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.mail.billing.deleteLatest({ id: '7231b5bc-c40e-4605-92cc-b4ded7afeff8' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
