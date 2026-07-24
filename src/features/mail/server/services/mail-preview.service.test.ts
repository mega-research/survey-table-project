import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FirstContactSample } from '@/lib/operations/contact-sample.server';

vi.mock('@/lib/operations/contact-sample.server', () => ({
  getFirstContactSample: vi.fn(),
  getContactSampleById: vi.fn(),
}));
vi.mock('@/lib/operations/data-scope.server', () => ({
  loadOperationsDataScope: vi.fn(),
}));
vi.mock('@/lib/mail/send', () => ({
  sendTestMail: vi.fn(),
}));
vi.mock('@/lib/mail/template-wrapper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mail/template-wrapper')>();
  return { MailWrapper: vi.fn(actual.MailWrapper) };
});

vi.mock('@/lib/mail/image-link-band-slices', () => ({
  ensureImageLinkBandSlices: vi.fn(async (html: string) => html),
}));

import { ensureImageLinkBandSlices } from '@/lib/mail/image-link-band-slices';
import { sendTestMail } from '@/lib/mail/send';
import { getContactSampleById, getFirstContactSample } from '@/lib/operations/contact-sample.server';
import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';
import { MailWrapper } from '@/lib/mail/template-wrapper';

import { getMailPreviewSample, sendTestTemplateMail } from './mail-preview.service';

const sampleData: FirstContactSample = {
  attrs: { name: '홍길동' },
  inviteCode: 'abc123',
  email: 'h@example.com',
  resid: 1,
};

const SURVEY_ID = 'sv-1';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';

describe('getMailPreviewSample', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('컨택 0건이면 null 을 반환한다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('test');
    vi.mocked(getFirstContactSample).mockResolvedValue(null);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://survey.example.com');
    const res = await getMailPreviewSample({ surveyId: 'sv-1' });
    expect(res).toBeNull();
    expect(getFirstContactSample).toHaveBeenCalledWith('sv-1', 'test');
  });

  it('NEXT_PUBLIC_APP_URL 기준으로 절대 inviteUrl 을 빌드한다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('real');
    vi.mocked(getFirstContactSample).mockResolvedValue(sampleData);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://survey.example.com/');
    const res = await getMailPreviewSample({ surveyId: 'sv-1' });
    expect(res).toEqual({
      attrs: sampleData.attrs,
      inviteUrl: 'https://survey.example.com/i/abc123',
      email: 'h@example.com',
      resid: 1,
    });
    expect(getFirstContactSample).toHaveBeenCalledWith('sv-1', 'real');
  });

  it('NEXT_PUBLIC_APP_URL 미설정 시 relative URL 을 조용히 반환하지 않고 명시적으로 throw 한다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('real');
    vi.mocked(getFirstContactSample).mockResolvedValue(sampleData);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    await expect(getMailPreviewSample({ surveyId: 'sv-1' })).rejects.toThrow(
      'NEXT_PUBLIC_APP_URL 환경변수가 설정되지 않았습니다.',
    );
  });

  it('contactTargetId 지정 시 getContactSampleById 로 해당 컨택 샘플을 쓴다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('real');
    vi.mocked(getContactSampleById).mockResolvedValue({
      attrs: { IDX: '5' },
      inviteCode: 'DktK3edZjq',
      email: 'play@funflow.co.kr',
      resid: 4,
    });
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://survey.example.com');
    const res = await getMailPreviewSample({ surveyId: SURVEY_ID, contactTargetId: CONTACT_ID });
    expect(getContactSampleById).toHaveBeenCalledWith(SURVEY_ID, CONTACT_ID, expect.anything());
    expect(getFirstContactSample).not.toHaveBeenCalled();
    expect(res?.resid).toBe(4);
    expect(res?.inviteUrl).toContain('/i/DktK3edZjq');
  });
});

describe('sendTestTemplateMail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadOperationsDataScope).mockResolvedValue('test');
    vi.mocked(getFirstContactSample).mockResolvedValue(sampleData);
    vi.mocked(sendTestMail).mockResolvedValue({ ok: true, id: 'message-1' });
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://survey.example.com');
    vi.stubEnv('RESEND_FROM_DOMAIN', 'mail.example.com');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('template footer와 sandbox invite·unsubscribe만 렌더한다', async () => {
    await sendTestTemplateMail({
      surveyId: '00000000-0000-4000-8000-000000000001',
      to: 'qa@example.com',
      subject: '설문 {{invite_link}}',
      bodyHtml: '<p>{{invite_link}}</p>',
      fromName: '조사팀',
      fromLocal: 'survey',
      replyTo: 'reply@example.com',
      attachments: [],
    });

    expect(vi.mocked(MailWrapper).mock.calls[0]?.[0]).toMatchObject({
      testFooterKind: 'template',
      unsubscribeUrl: 'https://survey.example.com/unsubscribe/__test__',
    });
    const sent = vi.mocked(sendTestMail).mock.calls.at(-1)?.[0];
    expect(sent?.html).toContain('https://survey.example.com/i/__test__');
    expect(sent?.html).not.toContain('/i/abc123');
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
    const sent = vi.mocked(sendTestMail).mock.calls.at(-1)?.[0];
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
