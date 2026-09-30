import { createRouterClient, ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';

vi.mock('../services/preview', () => ({
  getMailPreviewSample: vi.fn(),
  sendTestTemplateMail: vi.fn(),
}));

vi.mock('@/server/rpc-survey-access', () => ({ assertScopedSurveyCapabilityRpc: vi.fn() }));

import * as svc from '../services/preview';
import { preview } from './preview';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

function validSendInput() {
  return {
    surveyId: '11111111-1111-4111-8111-111111111111',
    to: 'me@example.com',
    subject: '제목',
    bodyHtml: '<p>본문</p>',
    fromName: '설문팀',
    fromLocal: 'noreply',
    replyTo: 'reply@example.com',
    attachments: [],
  };
}

describe('mail.preview procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sample은 service.getMailPreviewSample에 위임하고 결과를 반환한다', async () => {
    const sampleData = {
      attrs: { name: '홍길동' },
      inviteUrl: 'https://x/survey/sv-1?invite=tok',
      email: 'h@example.com',
      resid: 1,
    };
    vi.mocked(svc.getMailPreviewSample).mockResolvedValue(sampleData as never);
    const context = authedContext();
    const client = createRouterClient({ preview }, { context });
    const res = await client.preview.sample({ surveyId: 'sv-1' });
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      'sv-1',
      'mail.view',
    );
    expect(svc.getMailPreviewSample).toHaveBeenCalledWith({ surveyId: 'sv-1' });
    expect(res).toEqual(sampleData);
  });

  it('sample은 컨택 0건이면 null을 반환한다', async () => {
    vi.mocked(svc.getMailPreviewSample).mockResolvedValue(null as never);
    const client = createRouterClient({ preview }, { context: authedContext() });
    const res = await client.preview.sample({ surveyId: 'sv-1' });
    expect(res).toBeNull();
  });

  it('contactSample 은 mail.sendSingle 을 묻고 주체와 함께 서비스에 위임한다 (ADR-0027)', async () => {
    vi.mocked(svc.getMailPreviewSample).mockResolvedValue(null as never);
    const context = authedContext();
    const client = createRouterClient({ preview }, { context });
    const input = { surveyId: 'sv-1', contactTargetId: '33333333-3333-4333-8333-333333333333' };
    await client.preview.contactSample(input);
    // 단건 발송 창의 미리보기다 — 메일 탭(mail.view)이 없는 외주 링크도 지나야 한다.
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      'sv-1',
      'mail.sendSingle',
    );
    expect(svc.getMailPreviewSample).toHaveBeenCalledWith(input, context.user);
  });

  it('contactSample 은 대상 지목이 필수다 — 「첫 컨택」 폴백이 없다', async () => {
    const client = createRouterClient({ preview }, { context: authedContext() });
    await expect(
      client.preview.contactSample({ surveyId: 'sv-1' } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.getMailPreviewSample).not.toHaveBeenCalled();
  });

  it('testSend는 service.sendTestTemplateMail에 위임하고 결과객체를 반환한다', async () => {
    vi.mocked(svc.sendTestTemplateMail).mockResolvedValue({ ok: true, id: 'msg-1' } as never);
    const context = authedContext();
    const client = createRouterClient({ preview }, { context });
    const input = validSendInput();
    const res = await client.preview.testSend(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      input.surveyId,
      'mail.send',
    );
    expect(svc.sendTestTemplateMail).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true, id: 'msg-1' });
  });

  it('testSend는 env 가드 실패를 throw하지 않고 결과객체로 흘린다', async () => {
    vi.mocked(svc.sendTestTemplateMail).mockResolvedValue({
      ok: false,
      error: 'RESEND_FROM_DOMAIN 환경변수가 설정되지 않았습니다.',
    } as never);
    const client = createRouterClient({ preview }, { context: authedContext() });
    const res = await client.preview.testSend(validSendInput());
    expect(res).toEqual({
      ok: false,
      error: 'RESEND_FROM_DOMAIN 환경변수가 설정되지 않았습니다.',
    });
  });

  it('인증 없으면 sample이 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { preview },
      { context: { db: {} as never, user: null } },
    );
    await expect(
      client.preview.sample({ surveyId: 'sv-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('타 팀 설문 id 로 sample 하면 관문 NOT_FOUND — 서비스에 닿지 않는다', async () => {
    vi.mocked(assertScopedSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ preview }, { context: authedContext() });
    await expect(client.preview.sample({ surveyId: 'sv-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(svc.getMailPreviewSample).not.toHaveBeenCalled();
  });

  it('발송 권한 없는 설문에 testSend 하면 관문 FORBIDDEN — 서비스에 닿지 않는다', async () => {
    vi.mocked(assertScopedSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('FORBIDDEN', { message: '이 작업을 수행할 권한이 없습니다.' }),
    );
    const client = createRouterClient({ preview }, { context: authedContext() });
    await expect(client.preview.testSend(validSendInput())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(svc.sendTestTemplateMail).not.toHaveBeenCalled();
  });
});
