import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/mail-templates.service', async () => {
  const actual = await vi.importActual<
    typeof import('../services/mail-templates.service')
  >('../services/mail-templates.service');
  return {
    ...actual,
    createMailTemplate: vi.fn(),
    updateMailTemplate: vi.fn(),
    deleteMailTemplate: vi.fn(),
  };
});

import * as svc from '../services/mail-templates.service';
import { templates } from './templates';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

function validInput() {
  return {
    name: '안내 메일',
    subject: '안내드립니다',
    bodyHtml: '<p>본문</p>',
    fromLocal: 'noreply',
    fromName: '설문팀',
    replyTo: 'reply@example.com',
    attachments: [],
  };
}

describe('mail.templates procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create는 입력을 service.createMailTemplate에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.createMailTemplate).mockResolvedValue({
      id: 'tpl-1',
      bodyHtml: '<p>saved</p>',
      attachments: [],
    } as never);
    const client = createRouterClient({ templates }, { context: authedContext() });
    const input = { surveyId: 'sv-1', input: validInput() };
    const res = await client.templates.create(input);
    expect(svc.createMailTemplate).toHaveBeenCalledWith(input);
    expect(res).toEqual({ id: 'tpl-1', bodyHtml: '<p>saved</p>', attachments: [] });
  });

  it('update는 service.updateMailTemplate에 위임하고 저장본을 반환한다', async () => {
    vi.mocked(svc.updateMailTemplate).mockResolvedValue({
      bodyHtml: '<p>saved</p>',
      attachments: [],
    } as never);
    const client = createRouterClient({ templates }, { context: authedContext() });
    const input = { surveyId: 'sv-1', templateId: 'tpl-1', input: validInput() };
    const res = await client.templates.update(input);
    expect(svc.updateMailTemplate).toHaveBeenCalledWith(input);
    expect(res).toEqual({ bodyHtml: '<p>saved</p>', attachments: [] });
  });

  it('remove는 service.deleteMailTemplate에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.deleteMailTemplate).mockResolvedValue(undefined as never);
    const client = createRouterClient({ templates }, { context: authedContext() });
    const input = { surveyId: 'sv-1', templateId: 'tpl-1' };
    const res = await client.templates.remove(input);
    expect(svc.deleteMailTemplate).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
  });

  it('AttachmentPromoteError는 BAD_REQUEST 사용자 메시지로 매핑된다', async () => {
    vi.mocked(svc.createMailTemplate).mockRejectedValue(
      new svc.AttachmentPromoteError(['k1', 'k2']) as never,
    );
    const client = createRouterClient({ templates }, { context: authedContext() });
    await expect(
      client.templates.create({ surveyId: 'sv-1', input: validInput() }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '첨부 파일을 저장하지 못했습니다 (2개). 잠시 후 다시 시도해 주세요.',
    });
  });

  it('MailTemplateNotFoundError는 NOT_FOUND로 매핑된다', async () => {
    vi.mocked(svc.updateMailTemplate).mockRejectedValue(
      new svc.MailTemplateNotFoundError() as never,
    );
    const client = createRouterClient({ templates }, { context: authedContext() });
    await expect(
      client.templates.update({ surveyId: 'sv-1', templateId: 'tpl-x', input: validInput() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('인증 없으면 create가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { templates },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.templates.create({ surveyId: 'sv-1', input: validInput() }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
