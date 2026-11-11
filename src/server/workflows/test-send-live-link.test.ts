import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/data-scope', () => ({ loadOperationsDataScope: vi.fn() }));
vi.mock('@/server/read-models/contact-sample', () => ({ getFirstContactSample: vi.fn() }));
vi.mock('@/server/contacts/services/test-send-target', () => ({ ensureTestSendTarget: vi.fn() }));
vi.mock('@/server/mail/services/preview', () => ({ sendTestTemplateMail: vi.fn() }));

import { ensureTestSendTarget } from '@/server/contacts/services/test-send-target';
import { loadOperationsDataScope } from '@/server/data-scope';
import { sendTestTemplateMail } from '@/server/mail/services/preview';
import { getFirstContactSample } from '@/server/read-models/contact-sample';

import { sendTestTemplateMailWithLiveLink } from './test-send-live-link';

const input = {
  surveyId: '11111111-1111-4111-8111-111111111111',
  to: 'client@example.com',
  subject: '제목',
  bodyHtml: '<p>{{invite_link}}</p>',
  fromName: '설문팀',
  fromLocal: 'noreply',
  replyTo: 'reply@example.com',
  attachments: [],
};
const sample = { id: 'ct-real', attrs: { 전시회명: 'A' }, inviteCode: 'REAL01', email: null, resid: 1 };

describe('sendTestTemplateMailWithLiveLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadOperationsDataScope).mockResolvedValue('real');
    vi.mocked(getFirstContactSample).mockResolvedValue(sample);
    vi.mocked(sendTestTemplateMail).mockResolvedValue({ ok: true, id: 'm1', inviteLink: 'live' });
  });

  it('테스트 대상자 링크가 정해지면 그 초대 코드로 발송한다 — 샘플의 실제 코드는 넘기지 않는다', async () => {
    vi.mocked(ensureTestSendTarget).mockResolvedValue({
      kind: 'live',
      inviteCode: 'TEST99',
      created: true,
      attrs: { 전시회명: '사본이 읽은 값' },
    });

    const result = await sendTestTemplateMailWithLiveLink(input, false);

    expect(ensureTestSendTarget).toHaveBeenCalledWith({
      surveyId: input.surveyId,
      sampleTargetId: 'ct-real',
      recipientEmail: 'client@example.com',
      isGuest: false,
    });
    // 리뷰 3 — 본문 치환도 사본을 만든 그 값으로 한다(발송 서비스가 샘플을 다시 읽지 않는다)
    expect(sendTestTemplateMail).toHaveBeenCalledWith(input, {
      testInviteCode: 'TEST99',
      sampleAttrs: { 전시회명: '사본이 읽은 값' },
    });
    expect(result).toEqual({ ok: true, id: 'm1', inviteLink: 'live' });
  });

  it('테스트 모드가 꺼져 있으면(견본) 초대 코드 없이 발송한다', async () => {
    vi.mocked(ensureTestSendTarget).mockResolvedValue({ kind: 'sandbox', reason: 'test-mode-off' });
    vi.mocked(sendTestTemplateMail).mockResolvedValue({ ok: true, id: 'm1', inviteLink: 'sandbox' });

    const result = await sendTestTemplateMailWithLiveLink(input, false);

    expect(sendTestTemplateMail).toHaveBeenCalledWith(input, {});
    expect(result.inviteLink).toBe('sandbox');
  });

  it('테스트 대상자 상한에 걸리면 발송하지 않고 사유를 결과객체로 돌려준다', async () => {
    vi.mocked(ensureTestSendTarget).mockResolvedValue({ kind: 'limit', message: '테스트 대상자가 20명이라 …' });

    const result = await sendTestTemplateMailWithLiveLink(input, false);

    expect(sendTestTemplateMail).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: '테스트 대상자가 20명이라 …' });
  });

  it('조사 대상이 없으면 사본 단계를 건너뛰고 견본으로 발송한다', async () => {
    vi.mocked(getFirstContactSample).mockResolvedValue(null);

    await sendTestTemplateMailWithLiveLink(input, false);

    expect(ensureTestSendTarget).not.toHaveBeenCalled();
    expect(sendTestTemplateMail).toHaveBeenCalledWith(input, {});
  });

  it('초대 링크 변수가 없는 템플릿은 사본 단계를 건너뛰고 링크 종류도 알리지 않는다', async () => {
    vi.mocked(sendTestTemplateMail).mockResolvedValue({ ok: true, id: 'm1', inviteLink: 'sandbox' });

    const result = await sendTestTemplateMailWithLiveLink(
      { ...input, subject: '안내', bodyHtml: '<p>링크 없는 본문</p>' },
      false,
    );

    expect(getFirstContactSample).not.toHaveBeenCalled();
    expect(ensureTestSendTarget).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, id: 'm1' });
  });

  it.each([
    ['글자로만 적은 invite_link', '<p>invite_link 사용법</p>'],
    ['다른 변수 이름', '<p>{{my_invite_link}}</p>'],
  ])('리뷰 5 — %s 은 초대 링크 변수가 아니다(사본을 만들지 않는다)', async (_name, bodyHtml) => {
    await sendTestTemplateMailWithLiveLink({ ...input, subject: '안내', bodyHtml }, false);
    expect(ensureTestSendTarget).not.toHaveBeenCalled();
  });

  it.each([
    ['대체 문법', '<p>{{ invite_link || 링크 }}</p>'],
    ['주소를 비운 이미지 클릭 영역(기본이 초대 링크)', '<p><img src="a.png" data-link-rect="0,0,1,1"></p>'],
    ['초대 링크를 적은 이미지 클릭 영역', '<p><img src="a.png" data-link-rect="0,0,1,1" data-link-href="{{invite_link}}"></p>'],
  ])('리뷰 5 — %s 은 초대 링크를 쓰는 템플릿이다', async (_name, bodyHtml) => {
    vi.mocked(ensureTestSendTarget).mockResolvedValue({ kind: 'sandbox', reason: 'test-mode-off' });
    await sendTestTemplateMailWithLiveLink({ ...input, subject: '안내', bodyHtml }, false);
    expect(ensureTestSendTarget).toHaveBeenCalled();
  });

  it('리뷰 5 — 외부 주소만 건 이미지 클릭 영역은 초대 링크를 쓰지 않는다', async () => {
    await sendTestTemplateMailWithLiveLink(
      { ...input, subject: '안내', bodyHtml: '<p><img src="a.png" data-link-rect="0,0,1,1" data-link-href="https://example.com"></p>' },
      false,
    );
    expect(ensureTestSendTarget).not.toHaveBeenCalled();
  });

  it('게스트 여부를 사본 단계에 그대로 넘긴다', async () => {
    vi.mocked(ensureTestSendTarget).mockResolvedValue({ kind: 'sandbox', reason: 'guest' });

    await sendTestTemplateMailWithLiveLink(input, true);

    expect(vi.mocked(ensureTestSendTarget).mock.calls[0]?.[0]).toMatchObject({ isGuest: true });
    expect(sendTestTemplateMail).toHaveBeenCalledWith(input, {});
  });
});
