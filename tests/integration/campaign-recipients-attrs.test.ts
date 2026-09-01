import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listCampaignRecipients } from '@/lib/operations/campaigns.server';

/**
 * listCampaignRecipients 가 컨택 attrs 를 행에 실어 나르는지 검증.
 * 캠페인 상세 수신자 표가 컬럼 설정의 "메일 표시" attrs 컬럼을 그리려면
 * 행마다 contact_targets.attrs 가 필요하다 — 조인이 끊긴(삭제된) 컨택은 빈 객체.
 */

const state = {
  rows: [] as unknown[],
};

function buildChain() {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where() {
      const tail = {
        orderBy: () => tail,
        limit: () => tail,
        offset: () => Promise.resolve(state.rows),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve([{ total: state.rows.length }]).then(resolve),
      };
      return tail;
    },
  };
  return chain;
}

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => buildChain()),
  },
}));

const SURVEY_ID = '00000000-0000-4000-8000-000000000041';
const CAMPAIGN_ID = '00000000-0000-4000-8000-000000000042';

function recipientRow(overrides: Record<string, unknown>) {
  return {
    id: 'r-1',
    contactTargetId: 'ct-1',
    contactResid: 7,
    contactGroupValue: null,
    contactLatestResultCode: null,
    contactUnsubscribedAt: null,
    email: 'someone@example.com',
    status: 'sent',
    resendMessageId: null,
    errorReason: null,
    sentAt: null,
    deliveredAt: null,
    openedAt: null,
    bouncedAt: null,
    complainedAt: null,
    ...overrides,
  };
}

describe('listCampaignRecipients — 컨택 attrs 전달', () => {
  beforeEach(() => {
    state.rows = [];
  });

  it('행에 contact_targets.attrs 를 contactAttrs 로 싣는다', async () => {
    state.rows = [recipientRow({ contactAttrs: { 리스트ID: 'L-001', 회사명: '메가리서치' } })];

    const result = await listCampaignRecipients({
      surveyId: SURVEY_ID,
      campaignId: CAMPAIGN_ID,
      scope: 'real',
    });

    expect(result.rows[0]?.contactAttrs).toEqual({ 리스트ID: 'L-001', 회사명: '메가리서치' });
  });

  it('컨택 조인이 끊긴 행(삭제된 대상)은 빈 객체 — 표가 키 조회로 죽지 않는다', async () => {
    state.rows = [recipientRow({ contactTargetId: null, contactResid: null, contactAttrs: null })];

    const result = await listCampaignRecipients({
      surveyId: SURVEY_ID,
      campaignId: CAMPAIGN_ID,
      scope: 'real',
    });

    expect(result.rows[0]?.contactAttrs).toEqual({});
  });
});
