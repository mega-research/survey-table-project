import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SendAddressResolution } from '@/lib/mail/send-address';
import { resolveSendAddresses } from '@/server/read-models/send-address';
import { getResultCodeStatuses } from '@/server/read-models/result-code-statuses';

import { createCampaign } from './campaigns';
import { sendSingleCampaign } from './single-send';
import { getMailTemplate } from './templates';

const selectResultQueue: Array<Array<Record<string, unknown>>> = [];

vi.mock('@/db', () => {
  const chainFactory = () => {
    const chain: Record<string, unknown> = {};
    chain['from'] = () => chain;
    chain['where'] = () => chain;
    chain['orderBy'] = () => chain;
    chain['limit'] = async () => selectResultQueue.shift() ?? [];
    return chain;
  };
  return { db: { select: vi.fn(() => chainFactory()) } };
});

vi.mock('./campaigns', () => ({
  createCampaign: vi.fn(async () => ({ campaignId: 'camp-1', queuedCount: 1, skippedCount: 0 })),
}));

vi.mock('./templates', () => ({
  getMailTemplate: vi.fn(async () => ({ id: 'tpl-1', name: '리마인더' })),
}));

vi.mock('@/server/read-models/result-code-statuses', () => ({
  getResultCodeStatuses: vi.fn(async () => ({ negative: [] })),
  buildNegativeCodeExists: vi.fn(() => sql`FALSE`),
}));

// 보낼 주소 검사는 발송 주소 모듈의 resolveSendAddresses seam 을 탄다 — db 체인 큐와 분리해 고정한다.
vi.mock('@/server/read-models/send-address', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/read-models/send-address')>()),
  loadMailEmailOrder: vi.fn(async () => null),
  resolveSendAddresses: vi.fn(async () => new Map()),
}));

const INPUT = { surveyId: 'sv-1', contactTargetId: 'ct-1', mailTemplateId: 'tpl-1' };
const addressOf = (resolution: SendAddressResolution) => new Map([['ct-1', resolution]]);
const SENDABLE = addressOf({ kind: 'send', columnKey: 'email', email: 'a@x.com' });

describe('sendSingleCampaign 가드', () => {
  beforeEach(() => {
    selectResultQueue.length = 0;
    vi.clearAllMocks();
  });

  it('컨택이 없으면 에러', async () => {
    selectResultQueue.push([]); // contact 조회 empty
    await expect(sendSingleCampaign(INPUT, { accountUserId: 'admin-1', fieldworkLinkId: null }, false)).rejects.toThrow(
      '조사 대상을 찾을 수 없습니다.',
    );
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('수신거부 컨택이면 에러', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: new Date() }]);
    await expect(sendSingleCampaign(INPUT, { accountUserId: 'admin-1', fieldworkLinkId: null }, false)).rejects.toThrow(
      '수신거부된 조사 대상',
    );
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('최근 결과코드가 수신거부면 에러', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: null }]);
    selectResultQueue.push([{ id: 'ct-1' }]); // 최근 결과코드 수신거부
    await expect(sendSingleCampaign(INPUT, { accountUserId: 'admin-1', fieldworkLinkId: null }, false)).rejects.toThrow(
      '수신거부 결과코드가 기록된',
    );
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('부정 결과코드가 기록된 컨택이면 에러', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: null }]);
    selectResultQueue.push([]); // 결과코드 수신거부 없음
    vi.mocked(getResultCodeStatuses).mockResolvedValueOnce({ positive: [], negative: ['DNC'] });
    selectResultQueue.push([{ id: 'ct-1' }]); // 부정 결과코드 존재
    await expect(sendSingleCampaign(INPUT, { accountUserId: 'admin-1', fieldworkLinkId: null }, false)).rejects.toThrow(
      '연락금지 결과코드가 기록된',
    );
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('이메일 PII 가 없으면 에러', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: null }]);
    selectResultQueue.push([]); // 결과코드 수신거부 없음
    selectResultQueue.push([]); // 부정 결과코드 없음
    vi.mocked(resolveSendAddresses).mockResolvedValueOnce(addressOf({ kind: 'missing' }));
    await expect(sendSingleCampaign(INPUT, { accountUserId: 'admin-1', fieldworkLinkId: null }, false)).rejects.toThrow('이메일 정보가 없는');
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('반송은 단건을 막지 않는다 — 반송 주소를 넘기지 않고 판정한다', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: null }]);
    selectResultQueue.push([]); // 결과코드 수신거부 없음
    selectResultQueue.push([]); // 부정 결과코드 없음
    vi.mocked(resolveSendAddresses).mockResolvedValueOnce(SENDABLE);
    await sendSingleCampaign(INPUT, { accountUserId: 'admin-1', fieldworkLinkId: null }, false);
    expect(vi.mocked(resolveSendAddresses).mock.calls[0]).toHaveLength(3);
    expect(createCampaign).toHaveBeenCalled();
  });

  it('템플릿이 없으면 에러', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: null }]);
    selectResultQueue.push([]); // 결과코드 수신거부 없음
    selectResultQueue.push([]); // 부정 결과코드 없음
    vi.mocked(resolveSendAddresses).mockResolvedValueOnce(SENDABLE);
    vi.mocked(getMailTemplate).mockResolvedValueOnce(null);
    await expect(sendSingleCampaign(INPUT, { accountUserId: 'admin-1', fieldworkLinkId: null }, false)).rejects.toThrow(
      '메일 템플릿을 찾을 수 없습니다.',
    );
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('가드 통과 시 kind=single 로 createCampaign 위임', async () => {
    selectResultQueue.push([{ id: 'ct-1', surveyId: 'sv-1', unsubscribedAt: null }]);
    selectResultQueue.push([]); // 결과코드 수신거부 없음
    selectResultQueue.push([]); // 부정 결과코드 없음
    vi.mocked(resolveSendAddresses).mockResolvedValueOnce(SENDABLE);
    const res = await sendSingleCampaign(INPUT, { accountUserId: 'admin-1', fieldworkLinkId: null }, false);
    expect(createCampaign).toHaveBeenCalledWith(
      {
        surveyId: 'sv-1',
        mailTemplateId: 'tpl-1',
        title: '단건: 리마인더',
        contactTargetIds: ['ct-1'],
      },
      { accountUserId: 'admin-1', fieldworkLinkId: null },
      false,
      { kind: 'single' },
    );
    expect(res).toEqual({ campaignId: 'camp-1', queuedCount: 1, skippedCount: 0 });
  });
});
