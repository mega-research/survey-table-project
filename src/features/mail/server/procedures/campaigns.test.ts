import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/mail-campaigns.service', () => ({
  createCampaign: vi.fn(),
  cancelCampaign: vi.fn(),
  fetchCandidateIds: vi.fn(),
  previewPreflight: vi.fn(),
}));

vi.mock('../services/mail-single-send.service', () => ({
  sendSingleCampaign: vi.fn(),
}));

import * as svc from '../services/mail-campaigns.service';
import * as singleSvc from '../services/mail-single-send.service';
import { campaigns } from './campaigns';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN_ID = '44444444-4444-4444-8444-444444444444';

describe('mail.campaigns procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('create는 input과 context.user.id를 service.createCampaign에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.createCampaign).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      queuedCount: 1,
      skippedCount: 0,
    } as never);
    const client = createRouterClient({ campaigns }, { context: authedContext() });
    const input = {
      surveyId: SURVEY_ID,
      mailTemplateId: TEMPLATE_ID,
      title: '5월 리마인더',
      contactTargetIds: [CONTACT_ID],
    };
    const res = await client.campaigns.create(input);
    expect(svc.createCampaign).toHaveBeenCalledWith(input, 'admin-1', false);
    expect(res).toEqual({ campaignId: CAMPAIGN_ID, queuedCount: 1, skippedCount: 0 });
  });

  it('cancel은 service.cancelCampaign에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.cancelCampaign).mockResolvedValue(undefined as never);
    const client = createRouterClient({ campaigns }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, campaignId: CAMPAIGN_ID };
    const res = await client.campaigns.cancel(input);
    expect(svc.cancelCampaign).toHaveBeenCalledWith(input, false);
    expect(res).toEqual({ ok: true });
  });

  it('fetchCandidateIds는 service에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.fetchCandidateIds).mockResolvedValue({
      ids: [CONTACT_ID],
      total: 1,
      truncated: false,
    } as never);
    const client = createRouterClient({ campaigns }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, filter: { unrespondedOnly: true } };
    const res = await client.campaigns.fetchCandidateIds(input);
    expect(svc.fetchCandidateIds).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ids: [CONTACT_ID], total: 1, truncated: false });
  });

  it('previewPreflight는 service에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.previewPreflight).mockResolvedValue({
      validCount: 1,
      unsubscribedCount: 0,
      excludedByCodeCount: 0,
      emailMissingCount: 0,
      notFoundCount: 0,
    } as never);
    const client = createRouterClient({ campaigns }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, selectedContactIds: [CONTACT_ID] };
    const res = await client.campaigns.previewPreflight(input);
    expect(svc.previewPreflight).toHaveBeenCalledWith(input);
    expect(res).toEqual({
      validCount: 1,
      unsubscribedCount: 0,
      excludedByCodeCount: 0,
      emailMissingCount: 0,
      notFoundCount: 0,
    });
  });

  it('sendSingle은 input과 context.user.id를 sendSingleCampaign에 위임하고 결과를 반환한다', async () => {
    vi.mocked(singleSvc.sendSingleCampaign).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      queuedCount: 1,
      skippedCount: 0,
    } as never);
    const client = createRouterClient({ campaigns }, { context: authedContext() });
    const input = {
      surveyId: SURVEY_ID,
      contactTargetId: CONTACT_ID,
      mailTemplateId: TEMPLATE_ID,
    };
    const res = await client.campaigns.sendSingle(input);
    expect(singleSvc.sendSingleCampaign).toHaveBeenCalledWith(input, 'admin-1', false);
    expect(res).toEqual({ campaignId: CAMPAIGN_ID, queuedCount: 1, skippedCount: 0 });
  });

  it('인증 없으면 create가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { campaigns },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.campaigns.create({
        surveyId: SURVEY_ID,
        mailTemplateId: TEMPLATE_ID,
        title: '제목',
        contactTargetIds: [CONTACT_ID],
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('게스트는 grant 설문이면 sendSingle 이 위임된다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    vi.mocked(singleSvc.sendSingleCampaign).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      queuedCount: 1,
      skippedCount: 0,
    } as never);
    const client = createRouterClient(
      { campaigns },
      { context: { db: {} as never, supabase: {} as never, user: { id: 'guest-1', email: 'g@b.com' } } },
    );
    const input = {
      surveyId: SURVEY_ID,
      contactTargetId: CONTACT_ID,
      mailTemplateId: TEMPLATE_ID,
    };
    const res = await client.campaigns.sendSingle(input);
    expect(singleSvc.sendSingleCampaign).toHaveBeenCalledWith(input, 'guest-1', true);
    expect(res).toEqual({ campaignId: CAMPAIGN_ID, queuedCount: 1, skippedCount: 0 });
  });

  it('게스트는 grant 설문이면 create 가 isGuest=true 로 위임된다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    vi.mocked(svc.createCampaign).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      queuedCount: 1,
      skippedCount: 0,
    } as never);
    const client = createRouterClient(
      { campaigns },
      { context: { db: {} as never, supabase: {} as never, user: { id: 'guest-1', email: 'g@b.com' } } },
    );
    const input = {
      surveyId: SURVEY_ID,
      mailTemplateId: TEMPLATE_ID,
      title: '5월 리마인더',
      contactTargetIds: [CONTACT_ID],
    };
    const res = await client.campaigns.create(input);
    expect(svc.createCampaign).toHaveBeenCalledWith(input, 'guest-1', true);
    expect(res).toEqual({ campaignId: CAMPAIGN_ID, queuedCount: 1, skippedCount: 0 });
  });

  it('게스트가 다른 설문 surveyId 로 sendSingle 하면 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    const client = createRouterClient(
      { campaigns },
      { context: { db: {} as never, supabase: {} as never, user: { id: 'guest-1', email: 'g@b.com' } } },
    );
    await expect(
      client.campaigns.sendSingle({
        surveyId: '55555555-5555-4555-8555-555555555555',
        contactTargetId: CONTACT_ID,
        mailTemplateId: TEMPLATE_ID,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(singleSvc.sendSingleCampaign).not.toHaveBeenCalled();
  });
});
