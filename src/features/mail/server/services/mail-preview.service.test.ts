import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FirstContactSample } from '@/lib/operations/contact-sample.server';

vi.mock('@/lib/operations/contact-sample.server', () => ({
  getFirstContactSample: vi.fn(),
}));

vi.mock('@/lib/mail/image-link-band-slices', () => ({
  ensureImageLinkBandSlices: vi.fn(async (html: string) => html),
}));

vi.mock('@/lib/mail/send', () => ({
  sendTestMail: vi.fn(async () => ({ ok: true })),
}));

import { ensureImageLinkBandSlices } from '@/lib/mail/image-link-band-slices';
import { sendTestMail } from '@/lib/mail/send';
import { getFirstContactSample } from '@/lib/operations/contact-sample.server';

import { getMailPreviewSample, sendTestTemplateMail } from './mail-preview.service';

const sampleData: FirstContactSample = {
  attrs: { name: '홍길동' },
  inviteCode: 'abc123',
  email: 'h@example.com',
  resid: 1,
};

describe('getMailPreviewSample', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('컨택 0건이면 null 을 반환한다', async () => {
    vi.mocked(getFirstContactSample).mockResolvedValue(null);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://survey.example.com');
    const res = await getMailPreviewSample({ surveyId: 'sv-1' });
    expect(res).toBeNull();
  });

  it('NEXT_PUBLIC_APP_URL 기준으로 절대 inviteUrl 을 빌드한다', async () => {
    vi.mocked(getFirstContactSample).mockResolvedValue(sampleData);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://survey.example.com/');
    const res = await getMailPreviewSample({ surveyId: 'sv-1' });
    expect(res).toEqual({
      attrs: sampleData.attrs,
      inviteUrl: 'https://survey.example.com/i/abc123',
      email: 'h@example.com',
      resid: 1,
    });
  });

  it('NEXT_PUBLIC_APP_URL 미설정 시 relative URL 을 조용히 반환하지 않고 명시적으로 throw 한다', async () => {
    vi.mocked(getFirstContactSample).mockResolvedValue(sampleData);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    await expect(getMailPreviewSample({ surveyId: 'sv-1' })).rejects.toThrow(
      'NEXT_PUBLIC_APP_URL 환경변수가 설정되지 않았습니다.',
    );
  });
});

describe('sendTestTemplateMail - 클릭 영역 밴드', () => {
  const baseInput = {
    surveyId: '00000000-0000-0000-0000-000000000001',
    to: 'qa@example.com',
    subject: '제목',
    bodyHtml: '<p>본문</p>',
    fromName: '발신자',
    fromLocal: 'survey',
    replyTo: 'reply@example.com',
    attachments: [],
  };

  beforeEach(() => {
    vi.stubEnv('RESEND_FROM_DOMAIN', 'send.example.com');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
    vi.mocked(getFirstContactSample).mockResolvedValue(null);
    vi.mocked(ensureImageLinkBandSlices).mockImplementation(async (html: string) => html);
    vi.mocked(sendTestMail).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('미저장 초안이라도 발송 전에 밴드 슬라이스를 생성해 본문에 반영한다', async () => {
    vi.mocked(ensureImageLinkBandSlices).mockResolvedValue('<p>BANDS-DONE</p>');
    const result = await sendTestTemplateMail(baseInput);
    expect(result.ok).toBe(true);
    expect(ensureImageLinkBandSlices).toHaveBeenCalledWith('<p>본문</p>');
    const sent = vi.mocked(sendTestMail).mock.calls[0]?.[0];
    expect(sent?.html).toContain('BANDS-DONE');
  });

  it('밴드 슬라이스 실패 시 ok:false 와 에러 메시지를 반환한다', async () => {
    vi.mocked(ensureImageLinkBandSlices).mockRejectedValue(
      new Error('클릭 영역 이미지의 크기를 읽을 수 없습니다.'),
    );
    const result = await sendTestTemplateMail(baseInput);
    expect(result).toEqual({ ok: false, error: '클릭 영역 이미지의 크기를 읽을 수 없습니다.' });
    expect(sendTestMail).not.toHaveBeenCalled();
  });
});
