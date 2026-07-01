import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import type { QuotaConfig } from '@/db/schema/schema-types';

vi.mock('../services/quota.service', () => ({
  getQuotaConfig: vi.fn(),
  saveQuotaConfig: vi.fn(),
}));

import * as svc from '../services/quota.service';
import { quota } from './quota';

function authedContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: { id: 'admin-1', email: 'a@b.com' },
  } as ORPCContext;
}

const sampleConfig: QuotaConfig = {
  enabled: true,
  dimensions: [
    {
      id: 'd1',
      questionId: 'q1',
      label: '성별',
      kind: 'choice',
      categories: [{ id: 'c-f', label: '여성', values: ['female'] }],
    },
  ],
  cells: [{ categoryIds: ['c-f'], target: 10 }],
  closedMessage: null,
};

describe('quota procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('get은 service.getQuotaConfig 결과를 반환', async () => {
    vi.mocked(svc.getQuotaConfig).mockResolvedValue(sampleConfig);
    const client = createRouterClient({ quota }, { context: authedContext() });
    const res = await client.quota.get({ surveyId: 's1' });
    expect(svc.getQuotaConfig).toHaveBeenCalledWith('s1');
    expect(res).toEqual(sampleConfig);
  });

  it('get은 미설정 설문에 null 반환', async () => {
    vi.mocked(svc.getQuotaConfig).mockResolvedValue(null);
    const client = createRouterClient({ quota }, { context: authedContext() });
    expect(await client.quota.get({ surveyId: 's1' })).toBeNull();
  });

  it('save는 입력을 service.saveQuotaConfig에 위임', async () => {
    vi.mocked(svc.saveQuotaConfig).mockResolvedValue(sampleConfig);
    const client = createRouterClient({ quota }, { context: authedContext() });
    const res = await client.quota.save({ surveyId: 's1', config: sampleConfig });
    expect(svc.saveQuotaConfig).toHaveBeenCalledWith('s1', sampleConfig);
    expect(res).toEqual(sampleConfig);
  });

  it('target 음수는 입력 검증에서 거부', async () => {
    const client = createRouterClient({ quota }, { context: authedContext() });
    const bad = { ...sampleConfig, cells: [{ categoryIds: ['c-f'], target: -1 }] };
    await expect(client.quota.save({ surveyId: 's1', config: bad })).rejects.toBeTruthy();
    expect(svc.saveQuotaConfig).not.toHaveBeenCalled();
  });

  it('인증 없으면 UNAUTHORIZED', async () => {
    const client = createRouterClient(
      { quota },
      { context: { db: {} as never, supabase: {} as never, user: null } as ORPCContext },
    );
    await expect(client.quota.get({ surveyId: 's1' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
