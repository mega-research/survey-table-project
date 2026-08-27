import { createRouterClient, ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeQuotaConfig } from '@/lib/quota/normalize';
import type { ORPCContext } from '@/server/context';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import * as svc from '../services/quota';
import { quota } from './quota';

vi.mock('../services/quota', () => ({
  getQuotaConfig: vi.fn(),
  saveQuotaConfig: vi.fn(),
  checkQuota: vi.fn(),
  markQuotaFull: vi.fn(),
}));

vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

function authedContext(): ORPCContext {
  return {
    db: {} as never,
    user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'},
  } as ORPCContext;
}

// 프로덕션과 같은 입구를 거친다 — 정규화가 쿼터 플랜의 유일한 생산자다.
const sampleConfig = normalizeQuotaConfig({
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
})!;

describe('quota procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('get은 service.getQuotaConfig 결과를 반환', async () => {
    vi.mocked(svc.getQuotaConfig).mockResolvedValue(sampleConfig);
    const context = authedContext();
    const client = createRouterClient({ quota }, { context });
    const res = await client.quota.get({ surveyId: 's1' });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, 's1', 'operations.view');
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
    const context = authedContext();
    const client = createRouterClient({ quota }, { context });
    const res = await client.quota.save({ surveyId: 's1', config: sampleConfig });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, 's1', 'survey.edit');
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
      { context: { db: {} as never, user: null } as ORPCContext },
    );
    await expect(client.quota.get({ surveyId: 's1' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('타 팀 설문 id 로 get 하면 NOT_FOUND — 서비스에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ quota }, { context: authedContext() });
    await expect(client.quota.get({ surveyId: 's1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(svc.getQuotaConfig).not.toHaveBeenCalled();
  });

  it('편집권 없는 설문에 save 하면 FORBIDDEN — 서비스에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('FORBIDDEN', { message: '이 작업을 수행할 권한이 없습니다.' }),
    );
    const client = createRouterClient({ quota }, { context: authedContext() });
    await expect(
      client.quota.save({ surveyId: 's1', config: sampleConfig }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.saveQuotaConfig).not.toHaveBeenCalled();
  });

  it('check는 pub — 인증 없이 호출되고 service.checkQuota에 위임', async () => {
    vi.mocked(svc.checkQuota).mockResolvedValue({ blocked: true, closedMessage: '마감' });
    const client = createRouterClient(
      { quota },
      {
        context: {
          db: {} as never,
          user: null,
          headers: new Headers({ 'x-real-ip': '203.0.113.7' }),
        } as ORPCContext,
      },
    );
    const res = await client.quota.check({
      responseId: 'r1',
      surveyId: 's1',
      answers: { q1: 'female' },
    });
    expect(svc.checkQuota).toHaveBeenCalledWith({
      responseId: 'r1',
      surveyId: 's1',
      answers: { q1: 'female' },
    });
    // 응답자 표면은 capability 관문을 지나지 않는다 (티켓 10 무변경 계약).
    expect(assertSurveyCapabilityRpc).not.toHaveBeenCalled();
    expect(res).toEqual({ blocked: true, closedMessage: '마감' });
  });
});
