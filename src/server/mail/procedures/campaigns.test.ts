import { createRouterClient, ORPCError } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { linkActorContext } from '@tests/helpers/rpc-context';
import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';

vi.mock('../services/campaigns', () => ({
  createCampaign: vi.fn(),
  cancelCampaign: vi.fn(),
  resyncCampaign: vi.fn(),
  fetchCandidateIds: vi.fn(),
  previewPreflight: vi.fn(),
}));

vi.mock('../services/single-send', () => ({
  sendSingleCampaign: vi.fn(),
}));

vi.mock('@/server/rpc-survey-access', () => ({ assertScopedSurveyCapabilityRpc: vi.fn() }));

import * as svc from '../services/campaigns';
import * as singleSvc from '../services/single-send';
import { campaigns } from './campaigns';

/**
 * 링크 세션 해석만 대역으로 둔다 — 이 파일이 묻는 것은 **주체가 어떻게 귀속으로 바뀌는가**다
 * (쿠키의 유효성은 `fieldwork-link.realdb` 가 실 DB 로 진다). attempts.test.ts 와 같은 대역이다.
 */
vi.mock('@/server/access-link', () => ({
  resolveLinkActorForSurvey: vi.fn(
    async (sessions: readonly { claim: { linkId: string } }[] | undefined, surveyId: string) =>
      sessions?.length
        ? { kind: 'ok' as const, actor: { kind: 'link' as const, linkId: LINK_ID, surveyId, linkKind: 'fieldwork' as const } }
        : { kind: 'no_session' as const },
  ),
}));

const LINK_ID = 'e1000000-0000-4000-8000-00000000b002';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
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
    const context = authedContext();
    const client = createRouterClient({ campaigns }, { context });
    const input = {
      surveyId: SURVEY_ID,
      mailTemplateId: TEMPLATE_ID,
      title: '5월 리마인더',
      contactTargetIds: [CONTACT_ID],
    };
    const res = await client.campaigns.create(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'mail.send',
    );
    expect(svc.createCampaign).toHaveBeenCalledWith(input, { accountUserId: 'admin-1', fieldworkLinkId: null }, false);
    expect(res).toEqual({ campaignId: CAMPAIGN_ID, queuedCount: 1, skippedCount: 0 });
  });

  it('cancel은 service.cancelCampaign에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.cancelCampaign).mockResolvedValue(undefined as never);
    const context = authedContext();
    const client = createRouterClient({ campaigns }, { context });
    const input = { surveyId: SURVEY_ID, campaignId: CAMPAIGN_ID };
    const res = await client.campaigns.cancel(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'mail.send',
    );
    expect(svc.cancelCampaign).toHaveBeenCalledWith(input, false);
    expect(res).toEqual({ ok: true });
  });

  it('resync는 service.resyncCampaign에 위임하고 checked/updated를 반환한다', async () => {
    vi.mocked(svc.resyncCampaign).mockResolvedValue({ checked: 11, updated: 9 } as never);
    const context = authedContext();
    const client = createRouterClient({ campaigns }, { context });
    const input = { surveyId: SURVEY_ID, campaignId: CAMPAIGN_ID };
    const res = await client.campaigns.resync(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'mail.send',
    );
    expect(svc.resyncCampaign).toHaveBeenCalledWith(input);
    expect(res).toEqual({ checked: 11, updated: 9 });
  });

  it('fetchCandidateIds는 service에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.fetchCandidateIds).mockResolvedValue({
      ids: [CONTACT_ID],
      total: 1,
      truncated: false,
    } as never);
    const context = authedContext();
    const client = createRouterClient({ campaigns }, { context });
    const input = { surveyId: SURVEY_ID, filter: { unrespondedOnly: true } };
    const res = await client.campaigns.fetchCandidateIds(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'mail.send',
    );
    expect(svc.fetchCandidateIds).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ids: [CONTACT_ID], total: 1, truncated: false });
  });

  it('previewPreflight는 service에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.previewPreflight).mockResolvedValue({
      validCount: 1,
      unsubscribedCount: 0,
      excludedByCodeCount: 0,
      emailMissingCount: 0,
      bouncedCount: 0,
      notFoundCount: 0,
    } as never);
    const context = authedContext();
    const client = createRouterClient({ campaigns }, { context });
    const input = { surveyId: SURVEY_ID, selectedContactIds: [CONTACT_ID] };
    const res = await client.campaigns.previewPreflight(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'mail.send',
    );
    expect(svc.previewPreflight).toHaveBeenCalledWith(input);
    expect(res).toEqual({
      validCount: 1,
      unsubscribedCount: 0,
      excludedByCodeCount: 0,
      emailMissingCount: 0,
      bouncedCount: 0,
      notFoundCount: 0,
    });
  });

  it('sendSingle은 input과 context.user.id를 sendSingleCampaign에 위임하고 결과를 반환한다', async () => {
    vi.mocked(singleSvc.sendSingleCampaign).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      queuedCount: 1,
      skippedCount: 0,
    } as never);
    const context = authedContext();
    const client = createRouterClient({ campaigns }, { context });
    const input = {
      surveyId: SURVEY_ID,
      contactTargetId: CONTACT_ID,
      mailTemplateId: TEMPLATE_ID,
    };
    const res = await client.campaigns.sendSingle(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'mail.sendSingle',
    );
    expect(singleSvc.sendSingleCampaign).toHaveBeenCalledWith(input, { accountUserId: 'admin-1', fieldworkLinkId: null }, false);
    expect(res).toEqual({ campaignId: CAMPAIGN_ID, queuedCount: 1, skippedCount: 0 });
  });

  it('인증 없으면 create가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { campaigns },
      { context: { db: {} as never, user: null } },
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

  // 관문(mock)이 통과시킨 뒤 서비스로 넘어가는 파티션 플래그가 계정 유형에서 나온다(티켓 21).
  it('게스트 계정이면 sendSingle 이 실데이터 파티션으로 위임된다', async () => {
    vi.mocked(singleSvc.sendSingleCampaign).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      queuedCount: 1,
      skippedCount: 0,
    } as never);
    const client = createRouterClient(
      { campaigns },
      { context: { db: {} as never, user: { id: 'guest-1', email: 'g@b.com', name: '게스트', status: 'active', isSuperadmin: false, userType: 'guest' } } },
    );
    const input = {
      surveyId: SURVEY_ID,
      contactTargetId: CONTACT_ID,
      mailTemplateId: TEMPLATE_ID,
    };
    const res = await client.campaigns.sendSingle(input);
    expect(singleSvc.sendSingleCampaign).toHaveBeenCalledWith(input, { accountUserId: 'guest-1', fieldworkLinkId: null }, true);
    expect(res).toEqual({ campaignId: CAMPAIGN_ID, queuedCount: 1, skippedCount: 0 });
  });

  it('게스트 계정이면 create 가 실데이터 파티션으로 위임된다', async () => {
    vi.mocked(svc.createCampaign).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      queuedCount: 1,
      skippedCount: 0,
    } as never);
    const client = createRouterClient(
      { campaigns },
      { context: { db: {} as never, user: { id: 'guest-1', email: 'g@b.com', name: '게스트', status: 'active', isSuperadmin: false, userType: 'guest' } } },
    );
    const input = {
      surveyId: SURVEY_ID,
      mailTemplateId: TEMPLATE_ID,
      title: '5월 리마인더',
      contactTargetIds: [CONTACT_ID],
    };
    const res = await client.campaigns.create(input);
    expect(svc.createCampaign).toHaveBeenCalledWith(input, { accountUserId: 'guest-1', fieldworkLinkId: null }, true);
    expect(res).toEqual({ campaignId: CAMPAIGN_ID, queuedCount: 1, skippedCount: 0 });
  });

  it('타 팀 설문 id 로 create 하면 관문 NOT_FOUND — 서비스에 닿지 않는다', async () => {
    vi.mocked(assertScopedSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ campaigns }, { context: authedContext() });
    await expect(
      client.campaigns.create({
        surveyId: SURVEY_ID,
        mailTemplateId: TEMPLATE_ID,
        title: '제목',
        contactTargetIds: [CONTACT_ID],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(svc.createCampaign).not.toHaveBeenCalled();
  });

  it('발송 권한 없는 설문에 sendSingle 하면 관문 FORBIDDEN — 서비스에 닿지 않는다', async () => {
    vi.mocked(assertScopedSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('FORBIDDEN', { message: '이 작업을 수행할 권한이 없습니다.' }),
    );
    const client = createRouterClient({ campaigns }, { context: authedContext() });
    await expect(
      client.campaigns.sendSingle({
        surveyId: SURVEY_ID,
        contactTargetId: CONTACT_ID,
        mailTemplateId: TEMPLATE_ID,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(singleSvc.sendSingleCampaign).not.toHaveBeenCalled();
  });
});

describe('mail.campaigns — 외주 실사 링크 (ADR-0027)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('단건 발송은 mail.sendSingle 을 묻고 링크 칸에 귀속된다 — 실 파티션으로 위임된다', async () => {
    vi.mocked(singleSvc.sendSingleCampaign).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      queuedCount: 1,
      skippedCount: 0,
    } as never);
    const client = createRouterClient(
      { campaigns },
      { context: linkActorContext({ linkId: LINK_ID, surveyId: SURVEY_ID }) },
    );
    const input = { surveyId: SURVEY_ID, contactTargetId: CONTACT_ID, mailTemplateId: TEMPLATE_ID };
    await client.campaigns.sendSingle(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      { kind: 'link', linkId: LINK_ID, surveyId: SURVEY_ID, linkKind: 'fieldwork' },
      SURVEY_ID,
      'mail.sendSingle',
    );
    expect(singleSvc.sendSingleCampaign).toHaveBeenCalledWith(
      input,
      { accountUserId: null, fieldworkLinkId: LINK_ID },
      true,
    );
  });
});
