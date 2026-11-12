/**
 * 회신 전달 서비스 진입점 — 「어떤 메일이 들어오면 누구에게 어떤 메일이 나가는가」.
 *
 * 대역은 외부 경계뿐이다: Resend 클라이언트(받은 메일 조회·발송), 원본 내려받기(fetch),
 * 회신 주소 조회, 웹훅 장부. 원본 풀기(postal-mime)와 순수 규칙은 진짜를 쓴다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSentryCaptured } from '@/server/rpc-error-policy';

import { FORWARD_SIZE_BUDGET_BYTES, REPLY_FORWARD_HOURLY_CAP } from '../domain/reply-forward';
import { ReplyForwardCapExceeded, forwardReceivedReply } from './reply-forward';
import { findReplyAddressByRespondent, loadAccountReplyAddresses } from './reply-address-lookup';
import {
  countForwardedRepliesSince,
  isWebhookEventRecorded,
  recordReplyForwardEvent,
} from './reply-forward-ledger';

const { getMock, sendMock, logMock, sentryMessageMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  sendMock: vi.fn(),
  logMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sentryMessageMock: vi.fn(),
}));

vi.mock('./resend-client', () => ({
  getResend: () => ({ emails: { receiving: { get: getMock }, send: sendMock } }),
}));
vi.mock('./reply-address-lookup', () => ({
  findReplyAddressByRespondent: vi.fn(),
  loadAccountReplyAddresses: vi.fn(),
}));
vi.mock('./reply-forward-ledger', () => ({
  isWebhookEventRecorded: vi.fn(),
  recordReplyForwardEvent: vi.fn(),
  countForwardedRepliesSince: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: logMock }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: sentryMessageMock }));

const fetchMock = vi.fn();

const SEND_DOMAIN = 'send.example.co.kr';
const EVENT = { eventId: 'svix-1', receivedEmailId: 'recv-1' };
const RAW_URL = 'https://inbound.example/raw/recv-1';

const PDF_BASE64 = Buffer.from('%PDF-1.4 스캔본').toString('base64');
const PNG_BASE64 = Buffer.from('PNG-서명').toString('base64');

/** 본문(HTML·텍스트) + 본문 속 이미지 + PDF 첨부가 든 받은 메일 원본. 참조에 다른 사람이 있다. */
const RAW_EMAIL = [
  'From: =?UTF-8?B?6rmA7J2R64u1?= <kim@corp.co.kr>',
  'To: survey@send.example.co.kr',
  'Cc: colleague@corp.co.kr',
  'Subject: =?UTF-8?B?7ISk66y47KeAIO2ajOyLoA==?=',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="mix"',
  '',
  '--mix',
  'Content-Type: multipart/related; boundary="rel"',
  '',
  '--rel',
  'Content-Type: multipart/alternative; boundary="alt"',
  '',
  '--alt',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('스캔본 보냅니다').toString('base64'),
  '--alt',
  'Content-Type: text/html; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('<p>스캔본 보냅니다 <img src="cid:sign@corp"></p>').toString('base64'),
  '--alt--',
  '--rel',
  'Content-Type: image/png; name="sign.png"',
  'Content-Transfer-Encoding: base64',
  'Content-ID: <sign@corp>',
  'Content-Disposition: inline; filename="sign.png"',
  '',
  PNG_BASE64,
  '--rel--',
  '--mix',
  'Content-Type: application/pdf; name="survey.pdf"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="survey.pdf"',
  '',
  PDF_BASE64,
  '--mix--',
  '',
].join('\r\n');

interface ReceivedOverrides {
  from?: string;
  received_for?: string[];
  reply_to?: string[] | null;
  subject?: string;
  raw?: { download_url: string; expires_at: string } | null;
}

function receivedEmail(overrides: ReceivedOverrides = {}) {
  return {
    data: {
      object: 'email',
      id: EVENT.receivedEmailId,
      to: ['survey@send.example.co.kr'],
      from: '김응답 <kim@corp.co.kr>',
      created_at: '2026-11-12T01:00:00Z',
      subject: '설문지 회신',
      bcc: null,
      cc: ['colleague@corp.co.kr'],
      reply_to: null,
      received_for: ['survey@send.example.co.kr'],
      html: null,
      text: null,
      headers: null,
      message_id: '<m1@corp.co.kr>',
      raw: { download_url: RAW_URL, expires_at: '2026-11-12T02:00:00Z' },
      attachments: [],
      ...overrides,
    },
    error: null,
    headers: null,
  };
}

function rawResponse(raw: string | Buffer = RAW_EMAIL): Response {
  const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
  return new Response(new Uint8Array(bytes), { status: 200 });
}

/** 발송 요청(첫 인자)과 요청 옵션(둘째 인자). */
function sentRequest() {
  const call = sendMock.mock.calls[0];
  if (!call) throw new Error('발송 요청이 없다');
  return { mail: call[0] as Record<string, unknown>, options: call[1] as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env['RESEND_FROM_DOMAIN'] = SEND_DOMAIN;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => rawResponse());
  vi.stubGlobal('fetch', fetchMock);

  vi.mocked(isWebhookEventRecorded).mockResolvedValue(false);
  vi.mocked(recordReplyForwardEvent).mockResolvedValue(undefined);
  vi.mocked(countForwardedRepliesSince).mockResolvedValue(0);
  // 기본은 「응답자 주소가 수신자 기록에 없다」 — 계정 기준으로 물러난다.
  vi.mocked(findReplyAddressByRespondent).mockResolvedValue({ source: null, addresses: [] });
  vi.mocked(loadAccountReplyAddresses).mockResolvedValue({
    source: 'campaign',
    addresses: ['help@example.co.kr'],
  });
  getMock.mockResolvedValue(receivedEmail());
  sendMock.mockResolvedValue({ data: { id: 'out-1' }, error: null, headers: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('forwardReceivedReply — 넘기는 메일', () => {
  it('답장 한 통을 회신 주소로 받은 그대로 넘긴다', async () => {
    const result = await forwardReceivedReply(EVENT);

    expect(result).toEqual({
      outcome: 'forwarded',
      forwardCount: 1,
      sources: ['campaign'],
      alreadySent: false,
    });
    expect(getMock).toHaveBeenCalledWith('recv-1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(RAW_URL);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const { mail, options } = sentRequest();
    expect(mail).toEqual({
      from: '김응답 <survey@send.example.co.kr>',
      to: ['help@example.co.kr'],
      replyTo: ['kim@corp.co.kr'],
      subject: '설문지 회신',
      html: '<p>스캔본 보냅니다 <img src="cid:sign@corp"></p>',
      text: '스캔본 보냅니다',
      attachments: [
        { filename: 'sign.png', content: PNG_BASE64, contentType: 'image/png', contentId: 'sign@corp' },
        { filename: 'survey.pdf', content: PDF_BASE64, contentType: 'application/pdf' },
      ],
      tags: [{ name: 'kind', value: 'reply-forward' }],
    });
    expect(options).toEqual({ idempotencyKey: 'reply-forward/recv-1' });
  });

  it('원본의 참조·다른 받는 사람에게는 보내지 않는다', async () => {
    getMock.mockResolvedValue(
      receivedEmail({ received_for: ['survey@send.example.co.kr', 'other@corp.co.kr'] }),
    );

    await forwardReceivedReply(EVENT);

    const { mail } = sentRequest();
    expect(mail['to']).toEqual(['help@example.co.kr']);
    expect(mail).not.toHaveProperty('cc');
    expect(mail).not.toHaveProperty('bcc');
    expect(JSON.stringify(mail)).not.toContain('colleague@corp.co.kr');
  });

  it('받은 메일에 답장 주소가 따로 있으면 「답장」이 그 주소로 간다', async () => {
    getMock.mockResolvedValue(receivedEmail({ reply_to: ['팀 <team@corp.co.kr>'] }));

    await forwardReceivedReply(EVENT);

    expect(sentRequest().mail['replyTo']).toEqual(['team@corp.co.kr']);
  });

  it('이름 없이 보낸 메일이면 보낸 사람 이름 자리에 응답자 주소를 쓴다', async () => {
    getMock.mockResolvedValue(receivedEmail({ from: 'kim@corp.co.kr' }));
    fetchMock.mockImplementation(async () =>
      rawResponse(RAW_EMAIL.replace('From: =?UTF-8?B?6rmA7J2R64u1?= <kim@corp.co.kr>', 'From: kim@corp.co.kr')),
    );

    await forwardReceivedReply(EVENT);

    expect(sentRequest().mail['from']).toBe('"kim@corp.co.kr" <survey@send.example.co.kr>');
  });

  it('EUC-KR 8bit 로 온 본문도 깨지지 않는다 — 원본을 글자가 아니라 바이트로 읽는다', async () => {
    // 국내 메일 시스템이 흔히 보내는 모양. 본문 「안녕하세요」의 EUC-KR 바이트다.
    const eucKrBody = Buffer.from([0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4]);
    const raw = Buffer.concat([
      Buffer.from(
        [
          'From: kim@corp.co.kr',
          'To: survey@send.example.co.kr',
          'Subject: reply',
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=euc-kr',
          'Content-Transfer-Encoding: 8bit',
          '',
          '',
        ].join('\r\n'),
        'ascii',
      ),
      eucKrBody,
    ]);
    fetchMock.mockImplementation(async () => rawResponse(raw));

    await forwardReceivedReply(EVENT);

    const { mail } = sentRequest();
    expect(String(mail['text']).trim()).toBe('안녕하세요');
    expect(mail).not.toHaveProperty('html');
    expect(mail['attachments']).toEqual([]);
  });

  it('제목이 비면 「(제목 없음)」으로 보낸다', async () => {
    getMock.mockResolvedValue(receivedEmail({ subject: '' }));

    await forwardReceivedReply(EVENT);

    expect(sentRequest().mail['subject']).toBe('(제목 없음)');
  });

  it('보낸이 계정의 대소문자를 무시하고, 조회에는 소문자 계정과 발송 전용 도메인을 넘긴다', async () => {
    getMock.mockResolvedValue(receivedEmail({ received_for: ['Survey@SEND.example.co.kr'] }));

    await forwardReceivedReply(EVENT);

    expect(loadAccountReplyAddresses).toHaveBeenCalledWith(
      'survey',
      expect.objectContaining({ sendDomain: SEND_DOMAIN, now: expect.any(Date) }),
    );
    expect(sentRequest().mail['from']).toBe('김응답 <survey@send.example.co.kr>');
  });

  it('회신 주소가 여럿이면 전부에게 한 통으로 보낸다', async () => {
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({
      source: 'campaign',
      addresses: ['help@example.co.kr', 'ops@example.co.kr'],
    });

    const result = await forwardReceivedReply(EVENT);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sentRequest().mail['to']).toEqual(['help@example.co.kr', 'ops@example.co.kr']);
    expect(result).toMatchObject({ outcome: 'forwarded', forwardCount: 2 });
  });

  it('받는 주소에 보낸이 계정이 여럿이면 전달 주소를 합쳐 한 통으로 보내고, 쓴 적 있는 첫 계정을 보낸 사람으로 쓴다', async () => {
    getMock.mockResolvedValue(
      receivedEmail({
        received_for: ['ghost@send.example.co.kr', 'survey@send.example.co.kr', 'panel@send.example.co.kr'],
      }),
    );
    vi.mocked(loadAccountReplyAddresses).mockImplementation(async (account) => {
      if (account === 'survey') return { source: 'campaign', addresses: ['help@example.co.kr'] };
      if (account === 'panel') {
        return { source: 'template', addresses: ['HELP@example.co.kr', 'panel@example.co.kr'] };
      }
      return { source: null, addresses: [] };
    });

    const result = await forwardReceivedReply(EVENT);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const { mail } = sentRequest();
    expect(mail['to']).toEqual(['help@example.co.kr', 'panel@example.co.kr']);
    expect(mail['from']).toBe('김응답 <survey@send.example.co.kr>');
    expect(result).toMatchObject({ forwardCount: 2, sources: ['campaign', 'template'] });
  });

  it('넘긴 뒤 웹훅 장부에 「넘김」으로 적는다', async () => {
    await forwardReceivedReply(EVENT);

    expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
  });

  it('처리 순서: 장부 확인 → 조회·판정 → 원본 내려받기·발송 → 장부 기록', async () => {
    await forwardReceivedReply(EVENT);

    const order = (mock: { mock: { invocationCallOrder: number[] } }) => {
      const first = mock.mock.invocationCallOrder[0];
      if (first === undefined) throw new Error('호출되지 않았다');
      return first;
    };
    const sequence = [
      order(vi.mocked(isWebhookEventRecorded)),
      order(getMock),
      order(vi.mocked(loadAccountReplyAddresses)),
      order(fetchMock),
      order(sendMock),
      order(vi.mocked(recordReplyForwardEvent)),
    ];
    expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
  });
});

describe('forwardReceivedReply — 응답자 주소로 회신 주소 찾기', () => {
  it('답장 보낸 주소가 수신자 기록에 있으면 그 발송 회차의 회신 주소 한 곳으로만 넘긴다', async () => {
    vi.mocked(findReplyAddressByRespondent).mockResolvedValue({
      source: 'respondent',
      addresses: ['abc@example.co.kr'],
    });
    // 계정 기준이라면 이 계정이 쓴 회신 주소 전부에게 갔을 것이다.
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({
      source: 'campaign',
      addresses: ['abc@example.co.kr', 'cba@example.co.kr'],
    });

    const result = await forwardReceivedReply(EVENT);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sentRequest().mail['to']).toEqual(['abc@example.co.kr']);
    expect(result).toEqual({
      outcome: 'forwarded',
      forwardCount: 1,
      sources: ['respondent'],
      alreadySent: false,
    });
    expect(loadAccountReplyAddresses).not.toHaveBeenCalled();
  });

  it('수신자 기록에 없는 주소로 답장하면 그 계정의 회신 주소 전부에게 넘긴다', async () => {
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({
      source: 'campaign',
      addresses: ['abc@example.co.kr', 'cba@example.co.kr'],
    });

    const result = await forwardReceivedReply(EVENT);

    expect(sentRequest().mail['to']).toEqual(['abc@example.co.kr', 'cba@example.co.kr']);
    expect(result).toMatchObject({ outcome: 'forwarded', forwardCount: 2, sources: ['campaign'] });
  });

  it('찾는 재료는 보낸이 계정과 답장을 보낸 주소다 — 받은 메일이 따로 적은 답장 주소가 아니다', async () => {
    getMock.mockResolvedValue(
      receivedEmail({
        from: '김응답 <Kim@Corp.co.kr>',
        reply_to: ['team@corp.co.kr'],
        received_for: ['Survey@SEND.example.co.kr'],
      }),
    );

    await forwardReceivedReply(EVENT);

    expect(findReplyAddressByRespondent).toHaveBeenCalledTimes(1);
    expect(findReplyAddressByRespondent).toHaveBeenCalledWith('survey', 'Kim@Corp.co.kr', {
      sendDomain: SEND_DOMAIN,
    });
  });

  it('응답자 주소로 찾아도 전달 메일의 모양은 같다 — 보낸 사람·답장 주소·태그·멱등 키', async () => {
    vi.mocked(findReplyAddressByRespondent).mockResolvedValue({
      source: 'respondent',
      addresses: ['abc@example.co.kr'],
    });

    await forwardReceivedReply(EVENT);

    const { mail, options } = sentRequest();
    expect(mail).toMatchObject({
      from: '김응답 <survey@send.example.co.kr>',
      to: ['abc@example.co.kr'],
      replyTo: ['kim@corp.co.kr'],
      subject: '설문지 회신',
      tags: [{ name: 'kind', value: 'reply-forward' }],
    });
    expect(options).toEqual({ idempotencyKey: 'reply-forward/recv-1' });
  });

  it('보낸이 계정이 여럿이면 계정마다 따로 찾는다 — 한 계정은 응답자 주소로, 다른 계정은 계정 기준으로', async () => {
    getMock.mockResolvedValue(
      receivedEmail({ received_for: ['survey@send.example.co.kr', 'panel@send.example.co.kr'] }),
    );
    vi.mocked(findReplyAddressByRespondent).mockImplementation(async (account) =>
      account === 'survey'
        ? { source: 'respondent', addresses: ['abc@example.co.kr'] }
        : { source: null, addresses: [] },
    );
    vi.mocked(loadAccountReplyAddresses).mockImplementation(async (account) =>
      account === 'panel'
        ? { source: 'campaign', addresses: ['panel@example.co.kr'] }
        : { source: 'campaign', addresses: ['abc@example.co.kr', 'cba@example.co.kr'] },
    );

    const result = await forwardReceivedReply(EVENT);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sentRequest().mail['to']).toEqual(['abc@example.co.kr', 'panel@example.co.kr']);
    expect(result).toMatchObject({ forwardCount: 2, sources: ['respondent', 'campaign'] });
    expect(loadAccountReplyAddresses).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadAccountReplyAddresses).mock.calls[0]?.[0]).toBe('panel');
  });

  it('응답자 주소로 찾은 회신 주소가 보낸 사람과 같은 도메인이면 넘기지 않는다 — 회사 메일함 자동응답의 고리', async () => {
    getMock.mockResolvedValue(receivedEmail({ from: '자동응답 <help@example.co.kr>' }));
    vi.mocked(findReplyAddressByRespondent).mockResolvedValue({
      source: 'respondent',
      addresses: ['abc@example.co.kr'],
    });
    // 계정 기준이었다면 다른 도메인이라 넘겼을 것이다 — 판정은 실제로 넘길 전달 주소로 한다.
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({
      source: 'campaign',
      addresses: ['manager@other.co.kr'],
    });

    const result = await forwardReceivedReply(EVENT);

    expect(result).toEqual({ outcome: 'skipped', reason: 'company_domain' });
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'skipped');
  });

  it('응답자 주소로도 계정으로도 못 찾으면 쓴 적 없는 보낸이 계정이다', async () => {
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({ source: null, addresses: [] });

    const result = await forwardReceivedReply(EVENT);

    expect(result).toEqual({ outcome: 'skipped', reason: 'unused_sender_account' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('응답자 주소 조회 실패는 실패다 — 계정 기준으로 조용히 넘어가지 않는다', async () => {
    vi.mocked(findReplyAddressByRespondent).mockRejectedValue(new Error('db down'));

    await expect(forwardReceivedReply(EVENT)).rejects.toThrow();

    expect(loadAccountReplyAddresses).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });
});

describe('forwardReceivedReply — 넘기지 않는 메일', () => {
  /** 넘기지 않은 것은 정상 처리다 — 발송이 없고, 장부에 「넘기지 않음」으로 적힌다. */
  function expectSkipped(result: unknown, reason: string) {
    expect(result).toMatchObject({ outcome: 'skipped', reason });
    expect(sendMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'skipped');
  }

  it('웹훅 장부에 이미 있는 알림은 조회도 발송도 하지 않는다', async () => {
    vi.mocked(isWebhookEventRecorded).mockResolvedValue(true);

    const result = await forwardReceivedReply(EVENT);

    expect(result).toEqual({ outcome: 'deduped' });
    expect(getMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('받는 주소에 발송 전용 도메인의 주소가 없으면 넘기지 않는다', async () => {
    getMock.mockResolvedValue(receivedEmail({ received_for: ['someone@elsewhere.com'] }));

    expectSkipped(await forwardReceivedReply(EVENT), 'no_sender_account');
    expect(loadAccountReplyAddresses).not.toHaveBeenCalled();
  });

  it('쓴 적 없는 보낸이 계정으로 온 메일은 넘기지 않는다', async () => {
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({ source: null, addresses: [] });

    expectSkipped(await forwardReceivedReply(EVENT), 'unused_sender_account');
  });

  it('보낸 사람이 발송 전용 도메인이면 넘기지 않는다', async () => {
    getMock.mockResolvedValue(receivedEmail({ from: '설문팀 <survey@send.example.co.kr>' }));

    expectSkipped(await forwardReceivedReply(EVENT), 'company_domain');
  });

  it('보낸 사람이 전달 주소와 같은 도메인이면 넘기지 않는다 — 회사 메일함 자동응답의 고리', async () => {
    getMock.mockResolvedValue(receivedEmail({ from: '자동응답 <help@Example.co.kr>' }));

    expectSkipped(await forwardReceivedReply(EVENT), 'company_domain');
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it('회신 주소가 외부 메일이라 같은 도메인 응답자가 막히면 경고 로그를 남긴다', async () => {
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({
      source: 'campaign',
      addresses: ['manager@gmail.com'],
    });
    getMock.mockResolvedValue(receivedEmail({ from: '응답자 <someone@gmail.com>' }));

    expectSkipped(await forwardReceivedReply(EVENT), 'company_domain');
    expect(logMock.warn).toHaveBeenCalledTimes(1);
    expect(logMock.warn.mock.calls[0]?.[0]).toMatchObject({ externalReplyDomain: true });
  });

  it('보낸 사람 주소를 읽을 수 없으면 넘기지 않는다', async () => {
    getMock.mockResolvedValue(receivedEmail({ from: 'undisclosed-sender' }));

    expectSkipped(await forwardReceivedReply(EVENT), 'unreadable_sender');
  });
});

describe('forwardReceivedReply — 시간당 상한', () => {
  const HOUR_MS = 60 * 60 * 1000;

  it('최근 한 시간에 넘긴 건이 상한 바로 아래면 넘긴다 — 세는 범위는 지금부터 한 시간 전까지', async () => {
    vi.mocked(countForwardedRepliesSince).mockResolvedValue(REPLY_FORWARD_HOURLY_CAP - 1);
    const before = Date.now();

    const result = await forwardReceivedReply(EVENT);

    expect(result).toMatchObject({ outcome: 'forwarded' });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
    expect(sentryMessageMock).not.toHaveBeenCalled();

    expect(countForwardedRepliesSince).toHaveBeenCalledTimes(1);
    const since = vi.mocked(countForwardedRepliesSince).mock.calls[0]?.[0];
    expect(since).toBeInstanceOf(Date);
    expect(since!.getTime()).toBeGreaterThanOrEqual(before - HOUR_MS);
    expect(since!.getTime()).toBeLessThanOrEqual(Date.now() - HOUR_MS);
  });

  it('상한은 200통이다', () => {
    expect(REPLY_FORWARD_HOURLY_CAP).toBe(200);
  });

  it('최근 한 시간에 넘긴 건이 상한에 닿았으면 넘기지 않고 실패로 던진다 — 장부에 적지 않아 재시도가 뒤로 미룬다', async () => {
    vi.mocked(countForwardedRepliesSince).mockResolvedValue(REPLY_FORWARD_HOURLY_CAP);

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ReplyForwardCapExceeded);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('상한 초과는 Sentry 경고를 한 번 내고, 그 오류는 라우트가 다시 보내지 않게 표식을 단다', async () => {
    vi.mocked(countForwardedRepliesSince).mockResolvedValue(REPLY_FORWARD_HOURLY_CAP + 37);

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    expect(sentryMessageMock).toHaveBeenCalledTimes(1);
    expect(sentryMessageMock).toHaveBeenCalledWith('회신 전달 시간당 상한 초과', {
      level: 'warning',
      tags: { operation: 'reply_forward_cap' },
      extra: {
        receivedEmailId: 'recv-1',
        forwardedLastHour: REPLY_FORWARD_HOURLY_CAP + 37,
        cap: REPLY_FORWARD_HOURLY_CAP,
      },
    });
    expect(isSentryCaptured(error)).toBe(true);
  });

  it('상한 초과의 Sentry 경고·로그·오류 문구에 주소·이름·제목·본문을 싣지 않는다', async () => {
    vi.mocked(countForwardedRepliesSince).mockResolvedValue(REPLY_FORWARD_HOURLY_CAP);

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    expect(logMock.warn).toHaveBeenCalledTimes(1);
    expect(logMock.warn.mock.calls[0]?.[0]).toEqual({
      receivedEmailId: 'recv-1',
      outcome: 'deferred',
      reason: 'hourly_cap',
    });
    const exposed = JSON.stringify([
      sentryMessageMock.mock.calls,
      logMock.info.mock.calls,
      logMock.warn.mock.calls,
      (error as Error).message,
    ]);
    for (const fragment of ['kim@corp.co.kr', 'help@example.co.kr', 'corp.co.kr', '김응답', '설문지 회신', '스캔본']) {
      expect(exposed).not.toContain(fragment);
    }
  });

  it('넘기지 않는 메일은 상한을 넘긴 동안에도 「넘기지 않음」으로 끝난다 — 상한을 세지도, 막히지도 않는다', async () => {
    vi.mocked(countForwardedRepliesSince).mockResolvedValue(REPLY_FORWARD_HOURLY_CAP * 5);
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({ source: null, addresses: [] });

    const result = await forwardReceivedReply(EVENT);

    expect(result).toEqual({ outcome: 'skipped', reason: 'unused_sender_account' });
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'skipped');
    expect(countForwardedRepliesSince).not.toHaveBeenCalled();
    expect(sentryMessageMock).not.toHaveBeenCalled();
  });

  it('회사 도메인에서 온 메일도 상한과 무관하게 「넘기지 않음」이다', async () => {
    vi.mocked(countForwardedRepliesSince).mockResolvedValue(REPLY_FORWARD_HOURLY_CAP);
    getMock.mockResolvedValue(receivedEmail({ from: '자동응답 <help@example.co.kr>' }));

    const result = await forwardReceivedReply(EVENT);

    expect(result).toEqual({ outcome: 'skipped', reason: 'company_domain' });
    expect(countForwardedRepliesSince).not.toHaveBeenCalled();
  });

  it('이미 처리한 알림은 상한을 넘긴 동안에도 중복으로 끝난다', async () => {
    vi.mocked(countForwardedRepliesSince).mockResolvedValue(REPLY_FORWARD_HOURLY_CAP);
    vi.mocked(isWebhookEventRecorded).mockResolvedValue(true);

    expect(await forwardReceivedReply(EVENT)).toEqual({ outcome: 'deduped' });
    expect(countForwardedRepliesSince).not.toHaveBeenCalled();
  });

  it('상한 확인은 판정 뒤·원본 내려받기 앞이다', async () => {
    await forwardReceivedReply(EVENT);

    const order = (mock: { mock: { invocationCallOrder: number[] } }) => {
      const first = mock.mock.invocationCallOrder[0];
      if (first === undefined) throw new Error('호출되지 않았다');
      return first;
    };
    expect(order(vi.mocked(loadAccountReplyAddresses))).toBeLessThan(order(vi.mocked(countForwardedRepliesSince)));
    expect(order(vi.mocked(countForwardedRepliesSince))).toBeLessThan(order(fetchMock));
  });

  it('건수를 세지 못하면 실패다 — 상한을 모르는 채로 넘기지 않는다', async () => {
    vi.mocked(countForwardedRepliesSince).mockRejectedValue(new Error('db down'));

    await expect(forwardReceivedReply(EVENT)).rejects.toThrow();
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });
});

describe('forwardReceivedReply — 멱등성과 실패', () => {
  /** 실패는 던진다(라우트가 500 으로 답한다). 장부에 적지 않아 재시도가 처음부터 다시 한다. */
  async function expectFailure() {
    await expect(forwardReceivedReply(EVENT)).rejects.toThrow();
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  }

  it('같은 멱등 키에 내용이 다르다는 거절은 「이미 보냄」으로 보고 장부에 적는다', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'invalid_idempotent_request', statusCode: 409, message: 'payload mismatch' },
      headers: null,
    });

    const result = await forwardReceivedReply(EVENT);

    expect(result).toMatchObject({ outcome: 'forwarded', alreadySent: true });
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
    expect(logMock.warn).toHaveBeenCalledTimes(1);
  });

  it('같은 알림이 동시에 처리 중이라는 거절은 실패다 — 재시도가 장부에서 중복으로 끝낸다', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'concurrent_idempotent_requests', statusCode: 409, message: 'in progress' },
      headers: null,
    });

    await expectFailure();
  });

  it('받은 메일 조회 실패는 실패다', async () => {
    getMock.mockResolvedValue({
      data: null,
      error: { name: 'application_error', statusCode: 500, message: 'boom' },
      headers: null,
    });

    await expectFailure();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('원본이 아직 없으면 실패다', async () => {
    getMock.mockResolvedValue(receivedEmail({ raw: null }));

    await expectFailure();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('원본 내려받기 실패는 실패다', async () => {
    fetchMock.mockImplementation(async () => new Response('gone', { status: 403 }));

    await expectFailure();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('발송 실패는 실패이고, 오류 문구에 발송 서비스가 돌려준 글자를 싣지 않는다', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'validation_error',
        statusCode: 422,
        message: 'Invalid `to` field: help@example.co.kr',
      },
      headers: null,
    });

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('validation_error');
    expect((error as Error).message).not.toContain('help@example.co.kr');
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('회신 주소 조회 실패는 실패다', async () => {
    vi.mocked(loadAccountReplyAddresses).mockRejectedValue(new Error('db down'));

    await expectFailure();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('발송 전용 도메인 환경변수가 없으면 실패다 — 조용히 넘기지 않음으로 끝내지 않는다', async () => {
    delete process.env['RESEND_FROM_DOMAIN'];

    await expectFailure();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('forwardReceivedReply — 건별 로그', () => {
  const PRIVATE_FRAGMENTS = [
    'kim@corp.co.kr',
    'help@example.co.kr',
    'corp.co.kr',
    '김응답',
    '설문지 회신',
    '스캔본',
  ];

  function allLogText(): string {
    return JSON.stringify([
      ...logMock.info.mock.calls,
      ...logMock.warn.mock.calls,
      ...logMock.error.mock.calls,
    ]);
  }

  it('넘긴 건: 결과·주소를 찾은 방법·전달 주소 개수·받은 메일 id 를 한 줄로 남긴다', async () => {
    await forwardReceivedReply(EVENT);

    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info.mock.calls[0]?.[0]).toEqual({
      receivedEmailId: 'recv-1',
      outcome: 'forwarded',
      lookup: 'campaign',
      forwardCount: 1,
    });
    for (const fragment of PRIVATE_FRAGMENTS) expect(allLogText()).not.toContain(fragment);
  });

  it('응답자 주소로 찾아 넘긴 건: 주소를 찾은 방법이 계정 기준과 갈린다', async () => {
    vi.mocked(findReplyAddressByRespondent).mockResolvedValue({
      source: 'respondent',
      addresses: ['abc@example.co.kr'],
    });

    await forwardReceivedReply(EVENT);

    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info.mock.calls[0]?.[0]).toEqual({
      receivedEmailId: 'recv-1',
      outcome: 'forwarded',
      lookup: 'respondent',
      forwardCount: 1,
    });
    for (const fragment of [...PRIVATE_FRAGMENTS, 'abc@example.co.kr']) {
      expect(allLogText()).not.toContain(fragment);
    }
  });

  it('넘기지 않은 건: 이유를 남긴다', async () => {
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({ source: null, addresses: [] });

    await forwardReceivedReply(EVENT);

    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info.mock.calls[0]?.[0]).toEqual({
      receivedEmailId: 'recv-1',
      outcome: 'skipped',
      reason: 'unused_sender_account',
      forwardCount: 0,
    });
    for (const fragment of PRIVATE_FRAGMENTS) expect(allLogText()).not.toContain(fragment);
  });

  it('중복 알림도 한 줄 남긴다', async () => {
    vi.mocked(isWebhookEventRecorded).mockResolvedValue(true);

    await forwardReceivedReply(EVENT);

    expect(logMock.info.mock.calls[0]?.[0]).toEqual({ receivedEmailId: 'recv-1', outcome: 'deduped' });
  });

  it('경고 로그에도 주소·이름·제목·본문을 싣지 않는다', async () => {
    getMock.mockResolvedValue(receivedEmail({ from: '김응답 <kim@Example.co.kr>' }));
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({
      source: 'template',
      addresses: ['help@example.co.kr'],
    });

    await forwardReceivedReply(EVENT);

    for (const fragment of [...PRIVATE_FRAGMENTS, 'example.co.kr']) {
      expect(allLogText().toLowerCase()).not.toContain(fragment.toLowerCase());
    }
  });
});

describe('forwardReceivedReply — 첨부가 한도를 넘을 때', () => {
  const NOTICE_HEADLINE = '첨부 파일이 커서 함께 전달하지 못했습니다';
  const NOTICE_ORIGIN = '원본은 메일 발송 서비스(Resend) 수신 목록에 있습니다';

  /** 텍스트 본문 한 줄과 PDF 첨부 하나(지정한 바이트)가 든 원본. 첨부는 실제 메일처럼 76자 줄로 싣는다. */
  function rawWithAttachment(bodyText: string, attachmentBytes: number): Buffer {
    const encoded = Buffer.alloc(attachmentBytes, 0x41).toString('base64');
    return Buffer.from(
      [
        'From: =?UTF-8?B?6rmA7J2R64u1?= <kim@corp.co.kr>',
        'To: survey@send.example.co.kr',
        'Subject: scan',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="mix"',
        '',
        '--mix',
        'Content-Type: text/plain; charset=utf-8',
        '',
        bodyText,
        '--mix',
        'Content-Type: application/pdf; name="big.pdf"',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="big.pdf"',
        '',
        encoded.replace(/(.{76})/g, '$1\r\n'),
        '--mix--',
        '',
      ].join('\r\n'),
      'ascii',
    );
  }

  /**
   * 풀어 낸 텍스트 본문은 끝에 줄바꿈이 하나 붙는다 — 「abc」는 4바이트, 「abcd」는 5바이트.
   * 인코딩한 첨부가 (한도 - 4)글자면 「abc」 메일은 한도와 꼭 같고 「abcd」 메일은 1바이트 넘는다.
   */
  const ENCODED_ATTACHMENT_LENGTH = FORWARD_SIZE_BUDGET_BYTES - 4;
  const ATTACHMENT_BYTES = (ENCODED_ATTACHMENT_LENGTH / 4) * 3;

  function sentRequestAt(index: number) {
    const call = sendMock.mock.calls[index];
    if (!call) throw new Error(`${index + 1}번째 발송 요청이 없다`);
    return { mail: call[0] as Record<string, unknown>, options: call[1] as Record<string, unknown> };
  }

  function sizeRejection(overrides: { name?: string; statusCode?: number; message?: string } = {}) {
    return {
      data: null,
      error: { name: 'application_error', statusCode: 413, message: 'Request Entity Too Large', ...overrides },
      headers: null,
    };
  }

  const SENT = { data: { id: 'out-1' }, error: null, headers: null };

  it('경계 바로 아래 — 인코딩한 첨부와 본문이 한도와 꼭 같으면 01 과 똑같이 첨부째 넘긴다', async () => {
    fetchMock.mockImplementation(async () => rawResponse(rawWithAttachment('abc', ATTACHMENT_BYTES)));

    const result = await forwardReceivedReply(EVENT);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const { mail, options } = sentRequest();
    const attachments = mail['attachments'] as Array<{ filename: string; content: string }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.filename).toBe('big.pdf');
    // 이 메일이 정말 한도와 꼭 같은 크기인지 — 경계 계산이 어긋나면 여기서 드러난다.
    const text = String(mail['text']);
    expect((attachments[0]?.content.length ?? 0) + Buffer.byteLength(text)).toBe(FORWARD_SIZE_BUDGET_BYTES);
    expect(text).not.toContain(NOTICE_HEADLINE);
    expect(options).toEqual({ idempotencyKey: 'reply-forward/recv-1' });
    expect(result).toEqual({ outcome: 'forwarded', forwardCount: 1, sources: ['campaign'], alreadySent: false });
    expect(logMock.info.mock.calls[0]?.[0]).not.toHaveProperty('attachmentsOmitted');
  }, 30_000);

  it('경계 바로 위 — 1바이트라도 넘으면 첨부 없이 보내고 본문 맨 위에 안내와 빠진 파일의 이름·크기를 붙인다', async () => {
    fetchMock.mockImplementation(async () => rawResponse(rawWithAttachment('abcd', ATTACHMENT_BYTES)));

    const result = await forwardReceivedReply(EVENT);

    // 한도를 넘는 메일은 발송 서비스에 올려 보지도 않는다 — 한 번만 보낸다.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const { mail, options } = sentRequest();
    expect(mail['attachments']).toEqual([]);
    const text = String(mail['text']);
    expect(text.startsWith(`[안내] ${NOTICE_HEADLINE}`)).toBe(true);
    expect(text).toContain('- big.pdf (26.2 MB)');
    expect(text).toContain(NOTICE_ORIGIN);
    expect(text.trimEnd().endsWith('abcd')).toBe(true);
    expect(mail).not.toHaveProperty('html');
    // 받는 사람·보낸 사람 표기·답장 주소·제목·태그는 01 과 같다.
    expect(mail).toMatchObject({
      from: '김응답 <survey@send.example.co.kr>',
      to: ['help@example.co.kr'],
      replyTo: ['kim@corp.co.kr'],
      subject: '설문지 회신',
      tags: [{ name: 'kind', value: 'reply-forward' }],
    });
    expect(options).toEqual({ idempotencyKey: 'reply-forward/recv-1/no-attachments' });
    expect(result).toEqual({
      outcome: 'forwarded',
      forwardCount: 1,
      sources: ['campaign'],
      alreadySent: false,
      attachmentsOmitted: true,
    });
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
  }, 30_000);

  it.each<[string, { name?: string; statusCode?: number; message?: string }]>([
    ['413 응답', {}],
    ['크기를 말하는 검증 오류', { name: 'validation_error', statusCode: 422, message: 'Attachment size exceeds the 40MB limit' }],
  ])('발송 API 가 크기 초과로 거절하면(%s) 첨부 없이 한 번 더 보낸다', async (_name, rejection) => {
    sendMock.mockResolvedValueOnce(sizeRejection(rejection)).mockResolvedValueOnce(SENT);

    const result = await forwardReceivedReply(EVENT);

    expect(sendMock).toHaveBeenCalledTimes(2);
    const first = sentRequestAt(0);
    expect(first.mail['attachments']).toHaveLength(2);
    expect(first.options).toEqual({ idempotencyKey: 'reply-forward/recv-1' });

    // 같은 멱등 키로 내용이 다른 요청은 거절되므로 재발송은 다른 키로 나간다.
    const second = sentRequestAt(1);
    expect(second.options).toEqual({ idempotencyKey: 'reply-forward/recv-1/no-attachments' });
    expect(second.mail['attachments']).toEqual([]);
    const html = String(second.mail['html']);
    const text = String(second.mail['text']);
    for (const body of [html, text]) {
      expect(body).toContain(NOTICE_HEADLINE);
      expect(body).toContain('survey.pdf');
      // 본문 속 이미지도 함께 빠진다는 것이 목록에 드러난다.
      expect(body).toMatch(/sign\.png \([^)]*본문 속 이미지\)/);
      expect(body).toContain(NOTICE_ORIGIN);
    }
    expect(html.endsWith('<p>스캔본 보냅니다 <img src="cid:sign@corp"></p>')).toBe(true);
    expect(text.endsWith('스캔본 보냅니다')).toBe(true);
    expect(second.mail).toMatchObject({
      from: first.mail['from'],
      to: first.mail['to'],
      replyTo: first.mail['replyTo'],
      subject: first.mail['subject'],
      tags: first.mail['tags'],
    });
    expect(result).toMatchObject({ outcome: 'forwarded', attachmentsOmitted: true, alreadySent: false });
    expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
  });

  it('첨부를 뺀 재발송도 실패하면 실패다 — 세 번째는 없고 장부에 적지 않는다', async () => {
    sendMock
      .mockResolvedValueOnce(sizeRejection())
      .mockResolvedValueOnce({
        data: null,
        error: { name: 'application_error', statusCode: 500, message: 'boom' },
        headers: null,
      });

    await expect(forwardReceivedReply(EVENT)).rejects.toThrow();
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('첨부를 빼도 크기 초과면 실패다', async () => {
    sendMock.mockResolvedValue(sizeRejection());

    await expect(forwardReceivedReply(EVENT)).rejects.toThrow();
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('크기와 무관한 거절은 다시 보내지 않는다', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', statusCode: 422, message: 'Invalid `to` field' },
      headers: null,
    });

    await expect(forwardReceivedReply(EVENT)).rejects.toThrow();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('첨부가 없는 메일이 크기 초과로 거절되면 뺄 것이 없으니 다시 보내지 않고 실패다', async () => {
    fetchMock.mockImplementation(async () =>
      rawResponse(
        ['From: kim@corp.co.kr', 'To: survey@send.example.co.kr', 'Subject: x', '', 'hello', ''].join('\r\n'),
      ),
    );
    sendMock.mockResolvedValue(sizeRejection());

    await expect(forwardReceivedReply(EVENT)).rejects.toThrow();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('첨부를 뺀 재발송이 「같은 멱등 키에 내용이 다르다」로 거절되면 이미 보낸 것이다', async () => {
    sendMock.mockResolvedValueOnce(sizeRejection()).mockResolvedValueOnce({
      data: null,
      error: { name: 'invalid_idempotent_request', statusCode: 409, message: 'payload mismatch' },
      headers: null,
    });

    const result = await forwardReceivedReply(EVENT);

    expect(result).toMatchObject({ outcome: 'forwarded', alreadySent: true, attachmentsOmitted: true });
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
  });

  it('로그 결과에 「첨부 제외」가 남고, 파일 이름·주소·본문은 싣지 않는다', async () => {
    sendMock.mockResolvedValueOnce(sizeRejection()).mockResolvedValueOnce(SENT);

    await forwardReceivedReply(EVENT);

    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info.mock.calls[0]?.[0]).toEqual({
      receivedEmailId: 'recv-1',
      outcome: 'forwarded',
      lookup: 'campaign',
      forwardCount: 1,
      attachmentsOmitted: true,
    });
    const logged = JSON.stringify([...logMock.info.mock.calls, ...logMock.warn.mock.calls]);
    for (const fragment of ['survey.pdf', 'sign.png', 'kim@corp.co.kr', 'help@example.co.kr', '스캔본']) {
      expect(logged).not.toContain(fragment);
    }
  });

  it('발송 서비스가 돌려준 크기 초과 문구는 오류 문구에 싣지 않는다', async () => {
    sendMock.mockResolvedValue(
      sizeRejection({ name: 'validation_error', statusCode: 422, message: 'help@example.co.kr: size limit exceeded' }),
    );

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('help@example.co.kr');
  });
});
