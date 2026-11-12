/**
 * 회신 전달 서비스 진입점 — 「어떤 메일이 들어오면 누구에게 어떤 메일이 나가는가」.
 *
 * 대역은 외부 경계뿐이다: Resend 클라이언트(받은 메일 조회·발송), 원본 내려받기(fetch),
 * 회신 주소 조회, 웹훅 장부. 원본 풀기(postal-mime)와 순수 규칙은 진짜를 쓴다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSentryCaptured } from '@/server/rpc-error-policy';

import { FORWARD_SIZE_BUDGET_BYTES, REPLY_FORWARD_HOURLY_CAP } from '../domain/reply-forward';
import {
  REPLY_FORWARD_STEP_TIMEOUTS_MS,
  ReplyForwardCapExceeded,
  forwardReceivedReply,
} from './reply-forward';
import { findReplyAddressByRespondent, loadAccountReplyAddresses } from './reply-address-lookup';
import {
  isWebhookEventRecorded,
  recordReplyForwardEvent,
  reserveForwardSlot,
} from './reply-forward-ledger';

const { getMock, sendMock, logMock, sentryMessageMock, tracing } = vi.hoisted(() => ({
  getMock: vi.fn(),
  sendMock: vi.fn(),
  logMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sentryMessageMock: vi.fn(),
  /** Sentry 의 추적 끄기 구간 안인가 — 그 안에서 나간 요청은 breadcrumb·span 에 실리지 않는다. */
  tracing: { suppressed: false },
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
  reserveForwardSlot: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: logMock }));
vi.mock('@sentry/nextjs', () => ({
  captureMessage: sentryMessageMock,
  suppressTracing: <T,>(callback: () => T): T => {
    tracing.suppressed = true;
    try {
      return callback();
    } finally {
      tracing.suppressed = false;
    }
  },
}));

const fetchMock = vi.fn();

const SEND_DOMAIN = 'send.example.co.kr';
const RELAY_SECRET = 'test-relay-secret';
/**
 * 기본 받은 메일(kim@corp.co.kr → survey 계정)의 전달 메일이 쓰는 중계 주소.
 * 서명은 코드가 아니라 openssl 로 따로 계산한 글자다:
 *   printf '%s' 'reply-relay:v1:survey:kim@corp.co.kr' | openssl dgst -sha256 -hmac 'test-relay-secret'  → 앞 10자
 */
const RELAY_FROM_KIM = 'survey+kim=corp.co.kr=42a7387e98@send.example.co.kr';
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
  headers?: Record<string, string> | null;
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
  // 앞 테스트가 걸어 둔 한 번짜리 응답이 남아 다음 테스트로 새지 않게 한다.
  getMock.mockReset();
  sendMock.mockReset();
  process.env['RESEND_FROM_DOMAIN'] = SEND_DOMAIN;
  // 중계 주소의 서명 키 — 웹훅 서명 키를 그대로 쓴다.
  process.env['RESEND_WEBHOOK_SECRET'] = RELAY_SECRET;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => rawResponse());
  vi.stubGlobal('fetch', fetchMock);

  vi.mocked(isWebhookEventRecorded).mockResolvedValue(false);
  vi.mocked(recordReplyForwardEvent).mockResolvedValue(undefined);
  vi.mocked(reserveForwardSlot).mockResolvedValue({ reserved: true });
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
      from: `김응답 <${RELAY_FROM_KIM}>`,
      to: ['help@example.co.kr'],
      replyTo: ['kim@corp.co.kr'],
      subject: '설문지 회신',
      html: '<p>스캔본 보냅니다 <img src="cid:sign@corp"></p>',
      text: '스캔본 보냅니다',
      attachments: [
        { filename: 'sign.png', content: PNG_BASE64, contentType: 'image/png', contentId: 'sign@corp' },
        { filename: 'survey.pdf', content: PDF_BASE64, contentType: 'application/pdf' },
      ],
      headers: { 'X-Survey-Reply-Forward': '1', 'Auto-Submitted': 'auto-forwarded' },
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

    expect(sentRequest().mail['from']).toBe(`"kim@corp.co.kr" <${RELAY_FROM_KIM}>`);
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
    expect(sentRequest().mail['from']).toBe(`김응답 <${RELAY_FROM_KIM}>`);
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
    expect(mail['from']).toBe(`김응답 <${RELAY_FROM_KIM}>`);
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
      from: `김응답 <${RELAY_FROM_KIM}>`,
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
  /** 상한이 차서 자리를 못 잡았다 — 그때 한 시간 안에 잡혀 있던 자리 수와 함께. */
  const capFull = (slotsInWindow = REPLY_FORWARD_HOURLY_CAP) =>
    vi.mocked(reserveForwardSlot).mockResolvedValue({ reserved: false, slotsInWindow });

  it('자리를 잡으면 넘긴다 — 자리는 이 알림의 id 로 잡는다', async () => {
    const result = await forwardReceivedReply(EVENT);

    expect(result).toMatchObject({ outcome: 'forwarded' });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
    expect(sentryMessageMock).not.toHaveBeenCalled();
    // 같은 알림의 재시도가 자기 자리를 다시 쓰려면 자리의 열쇠가 알림 id 여야 한다.
    expect(reserveForwardSlot).toHaveBeenCalledTimes(1);
    expect(reserveForwardSlot).toHaveBeenCalledWith('svix-1');
  });

  it('상한은 200통이다', () => {
    expect(REPLY_FORWARD_HOURLY_CAP).toBe(200);
  });

  it('자리를 못 잡으면 넘기지 않고 실패로 던진다 — 장부에 적지 않아 재시도가 뒤로 미룬다', async () => {
    capFull();

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ReplyForwardCapExceeded);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('상한 초과는 Sentry 경고를 한 번 내고, 그 오류는 라우트가 다시 보내지 않게 표식을 단다', async () => {
    capFull(REPLY_FORWARD_HOURLY_CAP + 37);

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    expect(sentryMessageMock).toHaveBeenCalledTimes(1);
    expect(sentryMessageMock).toHaveBeenCalledWith('회신 전달 시간당 상한 초과', {
      level: 'warning',
      tags: { operation: 'reply_forward_cap' },
      extra: {
        receivedEmailId: 'recv-1',
        slotsLastHour: REPLY_FORWARD_HOURLY_CAP + 37,
        cap: REPLY_FORWARD_HOURLY_CAP,
      },
    });
    expect(isSentryCaptured(error)).toBe(true);
  });

  it('상한 초과의 Sentry 경고·로그·오류 문구에 주소·이름·제목·본문을 싣지 않는다', async () => {
    capFull();

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

  it('넘기지 않는 메일은 상한이 찬 동안에도 「넘기지 않음」으로 끝난다 — 자리를 잡지도, 막히지도 않는다', async () => {
    capFull(REPLY_FORWARD_HOURLY_CAP * 5);
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({ source: null, addresses: [] });

    const result = await forwardReceivedReply(EVENT);

    expect(result).toEqual({ outcome: 'skipped', reason: 'unused_sender_account' });
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'skipped');
    expect(reserveForwardSlot).not.toHaveBeenCalled();
    expect(sentryMessageMock).not.toHaveBeenCalled();
  });

  it('회사 도메인에서 온 메일도 상한과 무관하게 「넘기지 않음」이다', async () => {
    capFull();
    getMock.mockResolvedValue(receivedEmail({ from: '자동응답 <help@example.co.kr>' }));

    const result = await forwardReceivedReply(EVENT);

    expect(result).toEqual({ outcome: 'skipped', reason: 'company_domain' });
    expect(reserveForwardSlot).not.toHaveBeenCalled();
  });

  it('이미 처리한 알림은 상한이 찬 동안에도 중복으로 끝난다', async () => {
    capFull();
    vi.mocked(isWebhookEventRecorded).mockResolvedValue(true);

    expect(await forwardReceivedReply(EVENT)).toEqual({ outcome: 'deduped' });
    expect(reserveForwardSlot).not.toHaveBeenCalled();
  });

  it('자리는 판정 뒤·원본 내려받기 앞에 잡는다 — 발송 전이다', async () => {
    await forwardReceivedReply(EVENT);

    const order = (mock: { mock: { invocationCallOrder: number[] } }) => {
      const first = mock.mock.invocationCallOrder[0];
      if (first === undefined) throw new Error('호출되지 않았다');
      return first;
    };
    expect(order(vi.mocked(loadAccountReplyAddresses))).toBeLessThan(order(vi.mocked(reserveForwardSlot)));
    expect(order(vi.mocked(reserveForwardSlot))).toBeLessThan(order(fetchMock));
    expect(order(vi.mocked(reserveForwardSlot))).toBeLessThan(order(sendMock));
  });

  it('자리를 잡지 못하면(DB 오류) 실패다 — 상한을 모르는 채로 넘기지 않는다', async () => {
    vi.mocked(reserveForwardSlot).mockRejectedValue(new Error('db down'));

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

  it('「같은 알림이 처리 중」 거절은 장애가 아니다 — 실패로 던지되 Sentry 장애 이벤트가 나가지 않게 표식을 달고 로그만 남긴다', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'concurrent_idempotent_requests', statusCode: 409, message: 'in progress' },
      headers: null,
    });

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    // 라우트는 표식이 있는 오류를 Sentry 로 보내지 않는다(500 응답과 오류 로그는 그대로).
    expect(error).toBeInstanceOf(Error);
    expect(isSentryCaptured(error)).toBe(true);
    expect(sentryMessageMock).not.toHaveBeenCalled();
    expect(logMock.warn).toHaveBeenCalledTimes(1);
    expect(logMock.warn.mock.calls[0]?.[0]).toEqual({
      receivedEmailId: 'recv-1',
      outcome: 'deferred',
      reason: 'in_progress',
    });
    // 먼저 처리 중인 요청이 끝내면 재시도가 장부에서 중복으로 끝난다 — 여기서는 적지 않는다.
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('그 밖의 발송 실패는 표식 없이 던진다 — 라우트가 장애로 알린다', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'application_error', statusCode: 500, message: 'boom' },
      headers: null,
    });

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect(isSentryCaptured(error)).toBe(false);
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
        name: 'application_error',
        statusCode: 500,
        message: 'Failed to deliver to help@example.co.kr',
      },
      headers: null,
    });

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('application_error');
    expect((error as Error).message).not.toContain('help@example.co.kr');
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('「이미 보냄」으로 끝난 건은 Sentry 경고를 낸다 — 실제로 나갔는지 사람이 확인하도록', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'invalid_idempotent_request', statusCode: 409, message: 'payload mismatch for help@example.co.kr' },
      headers: null,
    });

    const result = await forwardReceivedReply(EVENT);

    // 동작은 그대로다 — 넘긴 것으로 보고 장부에 적는다.
    expect(result).toMatchObject({ outcome: 'forwarded', alreadySent: true });
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
    expect(sentryMessageMock).toHaveBeenCalledTimes(1);
    expect(sentryMessageMock).toHaveBeenCalledWith('회신 전달 멱등 키 내용 불일치 — 발송 여부 확인 필요', {
      level: 'warning',
      tags: { operation: 'reply_forward_idempotency_mismatch' },
      extra: { receivedEmailId: 'recv-1' },
    });
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
    // 받는 사람·보낸 사람 표기·답장 주소·제목·태그는 받은 그대로 보낼 때와 같다.
    expect(mail).toMatchObject({
      from: `김응답 <${RELAY_FROM_KIM}>`,
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

  it('다시 하면 될 수도 있는 거절(일시 장애)은 첨부를 빼고 다시 보내지 않는다 — 재시도에 맡긴다', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'application_error', statusCode: 500, message: 'boom' },
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
      sizeRejection({ name: 'application_error', statusCode: 413, message: 'help@example.co.kr: size limit exceeded' }),
    );

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('help@example.co.kr');
  });
});

describe('forwardReceivedReply — 다시 해도 안 되는 발송 거절', () => {
  const NEUTRAL_HEADLINE = '첨부 파일을 함께 전달하지 못했습니다';
  const SIZE_HEADLINE = '첨부 파일이 커서 함께 전달하지 못했습니다';
  const SENT = { data: { id: 'out-1' }, error: null, headers: null };

  function rejection(name: string, statusCode: number | null, message = 'rejected') {
    return { data: null, error: { name, statusCode, message }, headers: null };
  }

  function sentRequestAt(index: number) {
    const call = sendMock.mock.calls[index];
    if (!call) throw new Error(`${index + 1}번째 발송 요청이 없다`);
    return { mail: call[0] as Record<string, unknown>, options: call[1] as Record<string, unknown> };
  }

  const NO_ATTACHMENT_EMAIL = [
    'From: kim@corp.co.kr',
    'To: survey@send.example.co.kr',
    'Subject: x',
    '',
    'hello',
    '',
  ].join('\r\n');

  const RELAY_ADDRESS_WARNING = '회신 전달 중계 주소 발송 거절 — 보낸이 계정 주소로 다시 보냄';
  const GUIDE_LINE = '이 메일에 답장할 때는 받는 사람을 kim@corp.co.kr 로 직접 넣어 주세요.';

  it.each<[string, string, number]>([
    ['막힌 첨부 종류', 'invalid_attachment', 422],
    ['검증 오류', 'validation_error', 422],
    ['잘못된 값', 'invalid_parameter', 400],
  ])('검증 계열 거절(%s)은 중계 주소 → 보낸이 계정 주소 → 첨부 없는 모양으로 한 칸씩 물러난다 — 안내는 크기를 탓하지 않는다', async (_name, errorName, statusCode) => {
    sendMock
      .mockResolvedValueOnce(rejection(errorName, statusCode, 'Attachment type not allowed'))
      .mockResolvedValueOnce(rejection(errorName, statusCode, 'Attachment type not allowed'))
      .mockResolvedValueOnce(SENT);

    const result = await forwardReceivedReply(EVENT);

    expect(sendMock).toHaveBeenCalledTimes(3);
    // 첫 모양: 중계 주소 + 첨부.
    const first = sentRequestAt(0);
    expect(first.mail['attachments']).toHaveLength(2);
    expect(first.mail['from']).toBe(`김응답 <${RELAY_FROM_KIM}>`);
    expect(first.options).toEqual({ idempotencyKey: 'reply-forward/recv-1' });
    // 둘째 모양: 보낸이 계정 주소 + 첨부 + 「받는 사람을 직접」 안내. 어느 것이 거절의 까닭인지 모르니 첨부는 아직 싣는다.
    const second = sentRequestAt(1);
    expect(second.mail['attachments']).toHaveLength(2);
    expect(second.mail['from']).toBe('김응답 <survey@send.example.co.kr>');
    expect(second.options).toEqual({ idempotencyKey: 'reply-forward/recv-1/plain-from' });
    expect(String(second.mail['text'])).toContain(GUIDE_LINE);
    expect(String(second.mail['text'])).not.toContain(NEUTRAL_HEADLINE);
    // 셋째 모양: 첨부 없이.
    const third = sentRequestAt(2);
    expect(third.mail['attachments']).toEqual([]);
    expect(third.options).toEqual({ idempotencyKey: 'reply-forward/recv-1/plain-from/no-attachments' });
    for (const body of [String(third.mail['html']), String(third.mail['text'])]) {
      expect(body).toContain(GUIDE_LINE);
      expect(body).toContain(NEUTRAL_HEADLINE);
      expect(body).not.toContain(SIZE_HEADLINE);
      expect(body).toContain('survey.pdf');
      expect(body).toContain('원본은 메일 발송 서비스(Resend) 수신 목록에 있습니다');
    }
    // 받는 사람·보낸 사람 이름·답장 주소·제목은 그대로다.
    expect(third.mail).toMatchObject({
      from: '김응답 <survey@send.example.co.kr>',
      to: ['help@example.co.kr'],
      replyTo: ['kim@corp.co.kr'],
      subject: '설문지 회신',
    });
    expect(result).toMatchObject({
      outcome: 'forwarded',
      attachmentsOmitted: true,
      relayAddressOmitted: true,
      alreadySent: false,
    });
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
    // 경고는 중계 주소를 쓴 모양이 거절됐다는 것 하나뿐이다.
    expect(sentryMessageMock).toHaveBeenCalledTimes(1);
    expect(sentryMessageMock.mock.calls[0]?.[0]).toBe(RELAY_ADDRESS_WARNING);
  });

  it('크기 초과로 판정된 거절만 「커서」 문구를 쓴다', async () => {
    sendMock
      .mockResolvedValueOnce(rejection('validation_error', 422, 'Attachment size exceeds the 40MB limit'))
      .mockResolvedValueOnce(SENT);

    await forwardReceivedReply(EVENT);

    // 크기 초과는 중계 주소 탓이 아니다 — 보낸 사람 주소는 그대로 두고 첨부만 뺀다.
    expect(sendMock).toHaveBeenCalledTimes(2);
    const second = sentRequestAt(1);
    expect(String(second.mail['text'])).toContain(SIZE_HEADLINE);
    expect(second.mail['from']).toBe(`김응답 <${RELAY_FROM_KIM}>`);
    expect(second.options).toEqual({ idempotencyKey: 'reply-forward/recv-1/no-attachments' });
    expect(sentryMessageMock).not.toHaveBeenCalled();
  });

  it('첨부를 뺀 것도 거절되면 500 을 반복하지 않는다 — 「넘기지 않음」으로 적고 Sentry 경고를 내고 끝낸다', async () => {
    sendMock.mockResolvedValue(rejection('validation_error', 422, 'Invalid `to` field: help@example.co.kr'));

    const result = await forwardReceivedReply(EVENT);

    // 물러날 모양은 셋(중계 주소 → 보낸이 계정 주소 → 첨부 없음)이고 네 번째는 없다.
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ outcome: 'skipped', reason: 'send_rejected' });
    expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'skipped');
    expect(sentryMessageMock).toHaveBeenCalledTimes(2);
    expect(sentryMessageMock.mock.calls[0]?.[0]).toBe(RELAY_ADDRESS_WARNING);
    expect(sentryMessageMock).toHaveBeenLastCalledWith('회신 전달 발송 거절 — 넘기지 못함', {
      level: 'warning',
      tags: { operation: 'reply_forward_rejected' },
      extra: { receivedEmailId: 'recv-1', errorName: 'validation_error', statusCode: 422 },
    });
    expect(logMock.warn).toHaveBeenCalledTimes(1);
    expect(logMock.warn.mock.calls[0]?.[0]).toEqual({
      receivedEmailId: 'recv-1',
      outcome: 'skipped',
      reason: 'send_rejected',
      forwardCount: 0,
    });
  });

  it('끝내 거절된 건의 Sentry 경고·로그에 주소·제목·파일 이름·발송 서비스의 문구를 싣지 않는다', async () => {
    sendMock.mockResolvedValue(rejection('validation_error', 422, 'Invalid `to` field: help@example.co.kr'));

    await forwardReceivedReply(EVENT);

    const exposed = JSON.stringify([
      sentryMessageMock.mock.calls,
      logMock.info.mock.calls,
      logMock.warn.mock.calls,
      logMock.error.mock.calls,
    ]);
    for (const fragment of [
      'kim@corp.co.kr',
      'help@example.co.kr',
      'corp.co.kr',
      '김응답',
      '설문지 회신',
      'survey.pdf',
      'sign.png',
      'Invalid',
    ]) {
      expect(exposed).not.toContain(fragment);
    }
  });

  it('첨부가 없는 메일이 검증 오류로 거절되면 보낸이 계정 주소로 한 번 물러나고, 그것도 거절되면 뺄 것이 없으니 「넘기지 않음」으로 끝낸다', async () => {
    fetchMock.mockImplementation(async () => rawResponse(NO_ATTACHMENT_EMAIL));
    sendMock.mockResolvedValue(rejection('validation_error', 422));

    const result = await forwardReceivedReply(EVENT);

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sentRequestAt(1).options).toEqual({ idempotencyKey: 'reply-forward/recv-1/plain-from' });
    expect(result).toEqual({ outcome: 'skipped', reason: 'send_rejected' });
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'skipped');
    expect(sentryMessageMock).toHaveBeenCalledTimes(2);
    expect(sentryMessageMock.mock.calls[1]?.[0]).toBe('회신 전달 발송 거절 — 넘기지 못함');
  });

  it('크기 초과로 첨부를 뺀 재발송이 검증 오류로 거절되면 보낸이 계정 주소로 한 번 더 보내고, 그것도 거절되면 「넘기지 않음」으로 끝낸다 — 더 뺄 것이 없다', async () => {
    sendMock.mockResolvedValueOnce(rejection('application_error', 413)).mockResolvedValue(rejection('invalid_parameter', 422));

    const result = await forwardReceivedReply(EVENT);

    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sentRequestAt(1).options).toEqual({ idempotencyKey: 'reply-forward/recv-1/no-attachments' });
    expect(sentRequestAt(2).options).toEqual({ idempotencyKey: 'reply-forward/recv-1/plain-from/no-attachments' });
    expect(result).toEqual({ outcome: 'skipped', reason: 'send_rejected' });
    expect(sentryMessageMock).toHaveBeenLastCalledWith(
      '회신 전달 발송 거절 — 넘기지 못함',
      expect.objectContaining({ extra: { receivedEmailId: 'recv-1', errorName: 'invalid_parameter', statusCode: 422 } }),
    );
  });

  it.each<[string, string, number | null]>([
    ['발송 한도(429)', 'rate_limit_exceeded', 429],
    ['하루 한도(429)', 'daily_quota_exceeded', 429],
    ['서버 오류(5xx)', 'internal_server_error', 500],
    ['일시 장애(503)', 'application_error', 503],
    ['연결 실패(상태 없음)', 'application_error', null],
    ['API 키 문제(401)', 'invalid_api_key', 401],
    ['도메인 인증 문제(403)', 'validation_error', 403],
    ['멱등 키 형식(400)', 'invalid_idempotency_key', 400],
  ])('다시 하면 될 수 있는 거절(%s)은 물러나지 않고 실패로 던진다 — 메일을 조용히 버리지 않는다', async (_name, errorName, statusCode) => {
    sendMock.mockResolvedValue(rejection(errorName, statusCode));

    await expect(forwardReceivedReply(EVENT)).rejects.toThrow();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
    expect(sentryMessageMock).not.toHaveBeenCalled();
  });

  it('모양을 바꾼 재발송이 일시 장애면 실패로 던진다 — 재시도가 이어 간다', async () => {
    sendMock.mockResolvedValueOnce(rejection('validation_error', 422)).mockResolvedValueOnce(rejection('application_error', 500));

    await expect(forwardReceivedReply(EVENT)).rejects.toThrow();

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('첨부를 뺀 재발송이 일시 장애면 실패로 던진다 — 재시도가 이어 간다', async () => {
    sendMock
      .mockResolvedValueOnce(rejection('validation_error', 422))
      .mockResolvedValueOnce(rejection('validation_error', 422))
      .mockResolvedValueOnce(rejection('application_error', 500));

    await expect(forwardReceivedReply(EVENT)).rejects.toThrow();

    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sentRequestAt(2).mail['attachments']).toEqual([]);
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });
});

describe('forwardReceivedReply — 단계별 시간 제한', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const never = () => new Promise<never>(() => undefined);

  it('받은 메일 조회가 제한 시간 안에 끝나지 않으면 실패다 — 요청이 끝없이 매달리지 않는다', async () => {
    getMock.mockImplementation(never);

    const settled = forwardReceivedReply(EVENT).then(
      () => 'resolved',
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(REPLY_FORWARD_STEP_TIMEOUTS_MS.lookup - 1);
    expect(await Promise.race([settled, Promise.resolve('pending')])).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);

    const error = await settled;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('시간 초과');
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('발송 호출이 제한 시간 안에 끝나지 않으면 실패다 — 장부에 적지 않아 재시도가 멱등 키로 이어 간다', async () => {
    sendMock.mockImplementation(never);

    const settled = forwardReceivedReply(EVENT).then(
      () => 'resolved',
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(REPLY_FORWARD_STEP_TIMEOUTS_MS.send - 1);
    expect(await Promise.race([settled, Promise.resolve('pending')])).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);

    const error = await settled;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('시간 초과');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('첨부를 뺀 재발송은 더 짧은 제한 시간을 쓴다', async () => {
    sendMock
      .mockResolvedValueOnce({
        data: null,
        error: { name: 'application_error', statusCode: 413, message: 'Request Entity Too Large' },
        headers: null,
      })
      .mockImplementationOnce(never);

    const settled = forwardReceivedReply(EVENT).then(
      () => 'resolved',
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(REPLY_FORWARD_STEP_TIMEOUTS_MS.sendWithoutAttachments);

    const error = await settled;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('시간 초과');
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(REPLY_FORWARD_STEP_TIMEOUTS_MS.sendWithoutAttachments).toBeLessThan(REPLY_FORWARD_STEP_TIMEOUTS_MS.send);
  });

  it('제한 시간 안에 끝난 호출은 그대로 넘긴다 — 걸어 둔 시계가 남지 않는다', async () => {
    const result = await forwardReceivedReply(EVENT);

    expect(result).toMatchObject({ outcome: 'forwarded' });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('forwardReceivedReply — 넘기지 않을 메일은 받은 메일을 조회하기 전에 거른다', () => {
  /** 알림에 실려 온 받는 주소·보낸 사람 — 라우트가 넘긴다. */
  const HINTED = {
    ...EVENT,
    receivedFor: ['survey@send.example.co.kr'],
    from: '김응답 <kim@corp.co.kr>',
  };

  /** 걸러진 건은 발송 서비스 API 를 한 번도 부르지 않는다 — 조회도, 내려받기도, 발송도. */
  function expectFilteredWithoutApi(result: unknown, reason: string) {
    expect(result).toEqual({ outcome: 'skipped', reason });
    expect(getMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(reserveForwardSlot).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'skipped');
  }

  it('알림의 받는 주소에 발송 전용 도메인의 주소가 없으면 조회 없이 넘기지 않는다', async () => {
    const result = await forwardReceivedReply({ ...HINTED, receivedFor: ['someone@elsewhere.com'] });

    expectFilteredWithoutApi(result, 'no_sender_account');
    expect(loadAccountReplyAddresses).not.toHaveBeenCalled();
  });

  it('알림의 보낸 사람이 발송 전용 도메인이면 조회 없이 넘기지 않는다', async () => {
    const result = await forwardReceivedReply({ ...HINTED, from: '설문팀 <Survey@SEND.example.co.kr>' });

    expectFilteredWithoutApi(result, 'company_domain');
    expect(loadAccountReplyAddresses).not.toHaveBeenCalled();
  });

  it('쓴 적 없는 보낸이 계정으로 온 메일은 조회 없이 넘기지 않는다 — 스팸에 API 를 쓰지 않는다', async () => {
    vi.mocked(loadAccountReplyAddresses).mockResolvedValue({ source: null, addresses: [] });

    const result = await forwardReceivedReply({ ...HINTED, receivedFor: ['ghost@send.example.co.kr'] });

    expectFilteredWithoutApi(result, 'unused_sender_account');
    expect(loadAccountReplyAddresses).toHaveBeenCalledWith('ghost', expect.objectContaining({ sendDomain: SEND_DOMAIN }));
  });

  it('걸러진 건도 이유를 한 줄 남긴다 — 주소 없이', async () => {
    await forwardReceivedReply({ ...HINTED, receivedFor: ['someone@elsewhere.com'] });

    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info.mock.calls[0]?.[0]).toEqual({
      receivedEmailId: 'recv-1',
      outcome: 'skipped',
      reason: 'no_sender_account',
      forwardCount: 0,
    });
    expect(JSON.stringify(logMock.info.mock.calls)).not.toContain('elsewhere.com');
  });

  it('미리 걸러지지 않은 메일은 지금처럼 조회해서 넘긴다', async () => {
    const result = await forwardReceivedReply(HINTED);

    expect(result).toMatchObject({ outcome: 'forwarded', forwardCount: 1 });
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sentRequest().mail['to']).toEqual(['help@example.co.kr']);
  });

  it('알림 값과 조회한 값이 같으면 회신 주소를 두 번 찾지 않는다', async () => {
    await forwardReceivedReply(HINTED);

    expect(findReplyAddressByRespondent).toHaveBeenCalledTimes(1);
    expect(loadAccountReplyAddresses).toHaveBeenCalledTimes(1);
  });

  it('최종 판정은 조회한 값으로 한다 — 알림의 받는 주소는 통과했어도 조회한 받는 주소에 보낸이 계정이 없으면 넘기지 않는다', async () => {
    getMock.mockResolvedValue(receivedEmail({ received_for: ['someone@elsewhere.com'] }));

    const result = await forwardReceivedReply(HINTED);

    expect(result).toEqual({ outcome: 'skipped', reason: 'no_sender_account' });
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('최종 판정은 조회한 값으로 한다 — 전달 주소와 보낸 사람 표기는 조회한 받는 주소·보낸 사람에서 나온다', async () => {
    getMock.mockResolvedValue(
      receivedEmail({ received_for: ['panel@send.example.co.kr'], from: '박응답 <park@other.co.kr>' }),
    );
    vi.mocked(loadAccountReplyAddresses).mockImplementation(async (account) =>
      account === 'panel'
        ? { source: 'campaign', addresses: ['panel@example.co.kr'] }
        : { source: 'campaign', addresses: ['help@example.co.kr'] },
    );

    await forwardReceivedReply(HINTED);

    const { mail } = sentRequest();
    expect(mail['to']).toEqual(['panel@example.co.kr']);
    expect(mail['replyTo']).toEqual(['park@other.co.kr']);
    // 보낸 사람 주소의 계정도, 중계 주소에 담는 응답자 주소도 조회한 값이다(알림의 survey·kim 이 아니다).
    expect(String(mail['from'])).toContain('<panel+park=other.co.kr=9d39a32c6b@send.example.co.kr>');
    // 응답자 주소로 찾을 때도 조회한 보낸 사람을 쓴다.
    expect(findReplyAddressByRespondent).toHaveBeenLastCalledWith('panel', 'park@other.co.kr', {
      sendDomain: SEND_DOMAIN,
    });
  });

  it('알림의 보낸 사람을 읽을 수 없으면 미리 거르지 않고 조회한 값으로 판정한다', async () => {
    const result = await forwardReceivedReply({ ...HINTED, from: 'undisclosed-sender' });

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: 'forwarded' });
  });

  it('알림에 받는 주소·보낸 사람이 없으면 지금처럼 조회 뒤에 판정한다', async () => {
    getMock.mockResolvedValue(receivedEmail({ received_for: ['someone@elsewhere.com'] }));

    const result = await forwardReceivedReply(EVENT);

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ outcome: 'skipped', reason: 'no_sender_account' });
  });

  it('이미 처리한 알림은 미리 거르기보다 먼저 중복으로 끝난다', async () => {
    vi.mocked(isWebhookEventRecorded).mockResolvedValue(true);

    const result = await forwardReceivedReply({ ...HINTED, receivedFor: ['someone@elsewhere.com'] });

    expect(result).toEqual({ outcome: 'deduped' });
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  it('알림의 받는 주소가 빈 배열이면 「모름」이다 — 조회 없이 버리지 않고 조회한 값으로 판정해 넘긴다', async () => {
    // 받은 메일의 받는 주소가 0개일 수는 없다. 알림이 값을 싣지 못한 것이다.
    const result = await forwardReceivedReply({ ...HINTED, receivedFor: [] });

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: 'forwarded', forwardCount: 1 });
    expect(sentRequest().mail['to']).toEqual(['help@example.co.kr']);
    expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
  });

  it('알림의 받는 주소가 빈 배열이어도 최종 판정은 조회한 받는 주소로 한다', async () => {
    getMock.mockResolvedValue(receivedEmail({ received_for: ['someone@elsewhere.com'] }));

    const result = await forwardReceivedReply({ ...HINTED, receivedFor: [] });

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ outcome: 'skipped', reason: 'no_sender_account' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('알림의 받는 주소가 빈 배열이어도 보낸 사람이 발송 전용 도메인이면 조회 없이 넘기지 않는다', async () => {
    const result = await forwardReceivedReply({
      ...HINTED,
      receivedFor: [],
      from: '설문팀 <survey@send.example.co.kr>',
    });

    expectFilteredWithoutApi(result, 'company_domain');
  });
});

describe('forwardReceivedReply — 고리 표식', () => {
  /** 헤더 몇 줄과 텍스트 본문 한 줄짜리 원본. */
  function rawWithHeaders(headers: string[], from = 'kim@corp.co.kr'): string {
    return [`From: ${from}`, 'To: survey@send.example.co.kr', 'Subject: x', ...headers, '', 'hello', ''].join('\r\n');
  }

  function expectLoopSkipped(result: unknown, reason: string) {
    expect(result).toEqual({ outcome: 'skipped', reason });
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'skipped');
    // 이유를 로그에 남긴다.
    expect(logMock.info.mock.calls.at(-1)?.[0]).toEqual({
      receivedEmailId: 'recv-1',
      outcome: 'skipped',
      reason,
      forwardCount: 0,
    });
  }

  it('전달 메일에 자체 표식 헤더와 Auto-Submitted: auto-forwarded 를 붙인다', async () => {
    await forwardReceivedReply(EVENT);

    expect(sentRequest().mail['headers']).toEqual({
      'X-Survey-Reply-Forward': '1',
      'Auto-Submitted': 'auto-forwarded',
    });
  });

  it('우리 표식 헤더를 단 메일이 되돌아오면 넘기지 않는다 — 전달 메일이 끝없이 돌지 않는다', async () => {
    fetchMock.mockImplementation(async () => rawResponse(rawWithHeaders(['x-survey-reply-forward: 1'])));

    expectLoopSkipped(await forwardReceivedReply(EVENT), 'forward_loop');
  });

  it('조회 응답의 헤더에 표식이 보이면 원본을 내려받기 전에, 자리도 잡지 않고 끝낸다', async () => {
    getMock.mockResolvedValue(receivedEmail({ headers: { 'X-Survey-Reply-Forward': '1', Subject: 'x' } }));

    expectLoopSkipped(await forwardReceivedReply(EVENT), 'forward_loop');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reserveForwardSlot).not.toHaveBeenCalled();
  });

  it('배달 상태 통지(multipart/report 의 delivery-status)는 넘기지 않는다', async () => {
    const dsn = [
      'From: bounce@mx.other.co.kr',
      'To: survey@send.example.co.kr',
      'Subject: Undelivered Mail Returned to Sender',
      'MIME-Version: 1.0',
      'Content-Type: multipart/report; report-type=delivery-status; boundary="dsn"',
      '',
      '--dsn',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'This is the mail system. Your message could not be delivered.',
      '--dsn',
      'Content-Type: message/delivery-status',
      '',
      'Reporting-MTA: dns; mx.other.co.kr',
      '',
      'Final-Recipient: rfc822; help@example.co.kr',
      'Action: failed',
      'Status: 5.1.1',
      '--dsn--',
      '',
    ].join('\r\n');
    getMock.mockResolvedValue(receivedEmail({ from: 'Mail Delivery System <bounce@mx.other.co.kr>' }));
    fetchMock.mockImplementation(async () => rawResponse(dsn));

    expectLoopSkipped(await forwardReceivedReply(EVENT), 'delivery_report');
  });

  it.each(['MAILER-DAEMON@mx.other.co.kr', 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', 'postmaster@other.co.kr'])(
    '보낸 사람이 %s 이면 넘기지 않는다 — 내려받지도, 자리를 잡지도 않는다',
    async (from) => {
      getMock.mockResolvedValue(receivedEmail({ from }));

      expectLoopSkipped(await forwardReceivedReply(EVENT), 'delivery_report');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(reserveForwardSlot).not.toHaveBeenCalled();
    },
  );

  it('응답자의 부재중 자동응답은 지금처럼 넘긴다', async () => {
    fetchMock.mockImplementation(async () =>
      rawResponse(rawWithHeaders(['Auto-Submitted: auto-replied', 'X-Autoreply: yes', 'Precedence: bulk'])),
    );

    const result = await forwardReceivedReply(EVENT);

    expect(result).toMatchObject({ outcome: 'forwarded' });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('고리로 걸러진 건의 로그에 주소·제목을 싣지 않는다', async () => {
    getMock.mockResolvedValue(receivedEmail({ from: 'MAILER-DAEMON@mx.other.co.kr' }));

    await forwardReceivedReply(EVENT);

    const logged = JSON.stringify([logMock.info.mock.calls, logMock.warn.mock.calls]);
    for (const fragment of ['mx.other.co.kr', 'MAILER-DAEMON', '설문지 회신', 'help@example.co.kr']) {
      expect(logged).not.toContain(fragment);
    }
  });
});

describe('forwardReceivedReply — 첨부가 숨겨지지 않는다', () => {
  /** HTML 본문 + 내용 ID 가 붙은 일반 PDF(본문이 가리키지 않는다) + 본문이 가리키는 이미지. 본문 속(related) 묶음이 없다. */
  const RAW_WITH_CID_PDF = [
    'From: kim@corp.co.kr',
    'To: survey@send.example.co.kr',
    'Subject: scan',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="mix"',
    '',
    '--mix',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>scan attached <img src="cid:stamp@corp"></p>',
    '--mix',
    'Content-Type: application/pdf; name="scan.pdf"',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <part1.06090408.01060107@corp>',
    'Content-Disposition: attachment; filename="scan.pdf"',
    '',
    PDF_BASE64,
    '--mix',
    'Content-Type: image/png; name="stamp.png"',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <stamp@corp>',
    'Content-Disposition: inline; filename="stamp.png"',
    '',
    PNG_BASE64,
    '--mix--',
    '',
  ].join('\r\n');

  it('내용 ID 가 붙었을 뿐인 일반 PDF 는 일반 첨부로 보낸다 — 받는 쪽에서 첨부가 사라지지 않는다', async () => {
    fetchMock.mockImplementation(async () => rawResponse(RAW_WITH_CID_PDF));

    await forwardReceivedReply(EVENT);

    expect(sentRequest().mail['attachments']).toEqual([
      { filename: 'scan.pdf', content: PDF_BASE64, contentType: 'application/pdf' },
      // 본문이 실제로 가리키는 이미지는 내용 ID 를 유지해 본문에서 그대로 보인다.
      { filename: 'stamp.png', content: PNG_BASE64, contentType: 'image/png', contentId: 'stamp@corp' },
    ]);
  });

  it('원본 풀기가 본문 속(related)이라고 한 이미지는 본문이 가리키지 않아도 내용 ID 를 유지한다', async () => {
    // 서명 이미지를 본문 속 묶음에 넣었지만 본문이 `cid:` 로 가리키지 않는 메일.
    const encoded = (html: string) => Buffer.from(html).toString('base64');
    fetchMock.mockImplementation(async () =>
      rawResponse(
        RAW_EMAIL.replace(
          encoded('<p>스캔본 보냅니다 <img src="cid:sign@corp"></p>'),
          encoded('<p>스캔본 보냅니다</p>'),
        ),
      ),
    );

    await forwardReceivedReply(EVENT);

    const { mail } = sentRequest();
    expect(mail['html']).toBe('<p>스캔본 보냅니다</p>');
    expect(mail['attachments']).toEqual([
      { filename: 'sign.png', content: PNG_BASE64, contentType: 'image/png', contentId: 'sign@corp' },
      { filename: 'survey.pdf', content: PDF_BASE64, contentType: 'application/pdf' },
    ]);
  });

  it('첨부를 뺄 때 안내의 「본문 속 이미지」 표시도 같은 기준이다', async () => {
    fetchMock.mockImplementation(async () => rawResponse(RAW_WITH_CID_PDF));
    sendMock
      .mockResolvedValueOnce({
        data: null,
        error: { name: 'application_error', statusCode: 413, message: 'Request Entity Too Large' },
        headers: null,
      })
      .mockResolvedValueOnce({ data: { id: 'out-1' }, error: null, headers: null });

    await forwardReceivedReply(EVENT);

    const html = String(sendMock.mock.calls[1]?.[0]?.html);
    expect(html).toMatch(/<li>scan\.pdf \([^)]*B\)<\/li>/);
    expect(html).not.toMatch(/scan\.pdf \([^)]*본문 속 이미지\)/);
    expect(html).toMatch(/stamp\.png \([^)]*본문 속 이미지\)/);
  });

  it('첨부 파일 이름의 줄바꿈·제어 문자는 발송 요청에 실리지 않는다', async () => {
    // 이름에 줄바꿈을 숨긴 첨부 — MIME 인코딩된 이름은 풀고 나면 줄바꿈이 그대로 남는다.
    const sneaky = Buffer.from('scan\r\nBcc: victim@elsewhere.com.pdf').toString('base64');
    const raw = [
      'From: kim@corp.co.kr',
      'To: survey@send.example.co.kr',
      'Subject: scan',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="mix"',
      '',
      '--mix',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'hello',
      '--mix',
      'Content-Type: application/pdf',
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="=?UTF-8?B?${sneaky}?="`,
      '',
      PDF_BASE64,
      '--mix--',
      '',
    ].join('\r\n');
    fetchMock.mockImplementation(async () => rawResponse(raw));

    await forwardReceivedReply(EVENT);

    const attachments = sentRequest().mail['attachments'] as Array<{ filename: string }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.filename).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(attachments[0]?.filename).toBe('scan Bcc: victim@elsewhere.com.pdf');
  });
});

describe('forwardReceivedReply — 원본 내려받기 주소(서명된 URL)', () => {
  it('원본 내려받기 요청은 Sentry 추적 끄기 구간 안에서 나간다 — 서명이 breadcrumb·span 에 실리지 않는다', async () => {
    const suppressedAtFetch: boolean[] = [];
    fetchMock.mockImplementation(async () => {
      suppressedAtFetch.push(tracing.suppressed);
      return rawResponse();
    });

    await forwardReceivedReply(EVENT);

    expect(suppressedAtFetch).toEqual([true]);
    // 구간은 내려받기 요청에만 걸린다 — 발송 요청까지 감추지 않는다.
    expect(tracing.suppressed).toBe(false);
  });

  it('원본 내려받기 실패의 오류 문구·로그에 내려받기 주소를 싣지 않는다', async () => {
    const signedUrl = 'https://inbound.example/raw/recv-1?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA';
    getMock.mockResolvedValue(
      receivedEmail({ raw: { download_url: signedUrl, expires_at: '2026-11-12T02:00:00Z' } }),
    );
    fetchMock.mockImplementation(async () => {
      throw new TypeError(`fetch failed: ${signedUrl}`);
    });

    const error = await forwardReceivedReply(EVENT).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    const exposed = JSON.stringify([
      (error as Error).message,
      String((error as Error).cause ?? ''),
      logMock.info.mock.calls,
      logMock.warn.mock.calls,
      logMock.error.mock.calls,
      sentryMessageMock.mock.calls,
    ]);
    for (const fragment of ['X-Amz-Signature', 'deadbeef', 'inbound.example']) {
      expect(exposed).not.toContain(fragment);
    }
  });
});

describe('forwardReceivedReply — 전달 메일의 보낸 사람 주소(중계 주소)', () => {
  const SENT = { data: { id: 'out-1' }, error: null, headers: null };
  const GUIDE = (address: string) => `이 메일에 답장할 때는 받는 사람을 ${address} 로 직접 넣어 주세요.`;

  function rejection(name: string, statusCode: number | null, message = 'rejected') {
    return { data: null, error: { name, statusCode, message }, headers: null };
  }

  function sentRequestAt(index: number) {
    const call = sendMock.mock.calls[index];
    if (!call) throw new Error(`${index + 1}번째 발송 요청이 없다`);
    return { mail: call[0] as Record<string, unknown>, options: call[1] as Record<string, unknown> };
  }

  it('보낸 사람 주소에 응답자 주소와 서명을 담는다 — 이름·답장 주소는 그대로다', async () => {
    await forwardReceivedReply(EVENT);

    const { mail } = sentRequest();
    expect(mail['from']).toBe('김응답 <survey+kim=corp.co.kr=42a7387e98@send.example.co.kr>');
    // 답장 주소를 지키는 메일 프로그램은 중계를 거치지 않고 응답자에게 바로 간다.
    expect(mail['replyTo']).toEqual(['kim@corp.co.kr']);
    expect(JSON.stringify([mail['html'], mail['text']])).not.toContain('직접 넣어 주세요');
  });

  it('받은 메일에 답장 주소가 따로 있으면 중계 주소에 담는 것도 그 첫 번째 주소다', async () => {
    getMock.mockResolvedValue(receivedEmail({ reply_to: ['팀 <team@corp.co.kr>', 'boss@corp.co.kr'] }));

    await forwardReceivedReply(EVENT);

    const { mail } = sentRequest();
    // printf '%s' 'reply-relay:v1:survey:team@corp.co.kr' | openssl dgst -sha256 -hmac 'test-relay-secret' → db4558ed1c
    expect(mail['from']).toBe('김응답 <survey+team=corp.co.kr=db4558ed1c@send.example.co.kr>');
    expect(mail['replyTo']).toEqual(['team@corp.co.kr', 'boss@corp.co.kr']);
  });

  it.each<[string, string]>([
    ['@ 앞이 64자를 넘는다', `${'a'.repeat(36)}@corp.co.kr`],
    ["중계 주소로 옮길 수 없는 글자가 있다", "kim'o&lee@corp.co.kr"],
  ])('중계 주소를 쓸 수 없으면(%s) 보낸이 계정 주소로 보내고 본문 맨 위에 안내 한 줄을 붙인다', async (_name, address) => {
    getMock.mockResolvedValue(receivedEmail({ from: `김응답 <${address}>` }));

    const result = await forwardReceivedReply(EVENT);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const { mail, options } = sentRequest();
    expect(mail['from']).toBe('김응답 <survey@send.example.co.kr>');
    expect(mail['replyTo']).toEqual([address]);
    expect(String(mail['text'])).toBe(
      `[안내] ${GUIDE(address)}\n----------------------------------------\n\n스캔본 보냅니다`,
    );
    const html = String(mail['html']);
    expect(html.endsWith('<p>스캔본 보냅니다 <img src="cid:sign@corp"></p>')).toBe(true);
    expect(html).toContain(GUIDE(address).replace(/&/g, '&amp;').replace(/'/g, '&#39;'));
    // 첨부·받는 사람·제목은 그대로다.
    expect(mail['attachments']).toHaveLength(2);
    expect(mail['to']).toEqual(['help@example.co.kr']);
    expect(mail['subject']).toBe('설문지 회신');
    expect(options).toEqual({ idempotencyKey: 'reply-forward/recv-1/plain-from' });
    expect(result).toEqual({
      outcome: 'forwarded',
      forwardCount: 1,
      sources: ['campaign'],
      alreadySent: false,
      relayAddressOmitted: true,
    });
    // 발송 서비스가 거절한 것이 아니다 — 경고는 없고 로그 한 줄에 표시만 남는다.
    expect(sentryMessageMock).not.toHaveBeenCalled();
    expect(logMock.info.mock.calls[0]?.[0]).toEqual({
      receivedEmailId: 'recv-1',
      outcome: 'forwarded',
      lookup: 'campaign',
      forwardCount: 1,
      relayAddressOmitted: true,
    });
  });

  it('발송 서비스가 중계 주소를 거절하면 보낸이 계정 주소 + 첨부 + 안내 한 줄로 다시 보내고 Sentry 경고를 낸다', async () => {
    sendMock
      .mockResolvedValueOnce(rejection('validation_error', 422, 'Invalid `from` field: survey+kim=corp.co.kr'))
      .mockResolvedValueOnce(SENT);

    const result = await forwardReceivedReply(EVENT);

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sentRequestAt(0).options).toEqual({ idempotencyKey: 'reply-forward/recv-1' });
    const second = sentRequestAt(1);
    // 모양이 다르면 멱등 키도 다르다 — 같은 키로 내용이 다른 요청은 거절된다.
    expect(second.options).toEqual({ idempotencyKey: 'reply-forward/recv-1/plain-from' });
    expect(second.mail).toEqual({
      from: '김응답 <survey@send.example.co.kr>',
      to: ['help@example.co.kr'],
      replyTo: ['kim@corp.co.kr'],
      subject: '설문지 회신',
      html: expect.stringContaining(GUIDE('kim@corp.co.kr')),
      text: `[안내] ${GUIDE('kim@corp.co.kr')}\n----------------------------------------\n\n스캔본 보냅니다`,
      attachments: [
        { filename: 'sign.png', content: PNG_BASE64, contentType: 'image/png', contentId: 'sign@corp' },
        { filename: 'survey.pdf', content: PDF_BASE64, contentType: 'application/pdf' },
      ],
      headers: { 'X-Survey-Reply-Forward': '1', 'Auto-Submitted': 'auto-forwarded' },
      tags: [{ name: 'kind', value: 'reply-forward' }],
    });
    expect(result).toEqual({
      outcome: 'forwarded',
      forwardCount: 1,
      sources: ['campaign'],
      alreadySent: false,
      relayAddressOmitted: true,
    });
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
    expect(sentryMessageMock).toHaveBeenCalledTimes(1);
    expect(sentryMessageMock).toHaveBeenCalledWith('회신 전달 중계 주소 발송 거절 — 보낸이 계정 주소로 다시 보냄', {
      level: 'warning',
      tags: { operation: 'reply_forward_relay_address_rejected' },
      extra: { receivedEmailId: 'recv-1', errorName: 'validation_error', statusCode: 422 },
    });
  });

  it('중계 주소 거절의 Sentry 경고·로그에 주소·이름·제목·발송 서비스의 문구를 싣지 않는다', async () => {
    sendMock
      .mockResolvedValueOnce(rejection('validation_error', 422, 'Invalid `from` field: survey+kim=corp.co.kr'))
      .mockResolvedValueOnce(SENT);

    await forwardReceivedReply(EVENT);

    const exposed = JSON.stringify([
      sentryMessageMock.mock.calls,
      logMock.info.mock.calls,
      logMock.warn.mock.calls,
      logMock.error.mock.calls,
    ]);
    for (const fragment of ['kim', 'corp.co.kr', 'help@example.co.kr', '42a7387e98', '김응답', '설문지 회신', 'Invalid']) {
      expect(exposed).not.toContain(fragment);
    }
  });

  it('응답자가 중계 주소로 답장해도 그 계정의 회신 전달로 처리된다 — 회사 밖에서 온 메일은 꼬리를 무시한다', async () => {
    // 박응답이 (전달받은 메일을 넘겨받았든 어쨌든) 서명이 맞는 중계 주소로 메일을 보냈다.
    getMock.mockResolvedValue(
      receivedEmail({ from: '박응답 <park@other.co.kr>', received_for: [RELAY_FROM_KIM] }),
    );

    const result = await forwardReceivedReply(EVENT);

    expect(result).toMatchObject({ outcome: 'forwarded', forwardCount: 1 });
    // 꼬리를 떼고 본 계정으로 회신 주소를 찾는다.
    expect(findReplyAddressByRespondent).toHaveBeenCalledWith('survey', 'park@other.co.kr', {
      sendDomain: SEND_DOMAIN,
    });
    const { mail, options } = sentRequest();
    // 중계 주소가 가리키는 kim 에게 가지 않는다 — 회신 주소로 간다.
    expect(mail['to']).toEqual(['help@example.co.kr']);
    expect(mail['tags']).toEqual([{ name: 'kind', value: 'reply-forward' }]);
    expect(mail['replyTo']).toEqual(['park@other.co.kr']);
    // printf '%s' 'reply-relay:v1:survey:park@other.co.kr' | openssl dgst -sha256 -hmac 'test-relay-secret' → 74e0ba501b
    expect(String(mail['from'])).toContain('<survey+park=other.co.kr=74e0ba501b@send.example.co.kr>');
    expect(options).toEqual({ idempotencyKey: 'reply-forward/recv-1' });
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'forwarded');
  });

  it('서명 키(RESEND_WEBHOOK_SECRET)가 없으면 실패다 — 서명 없는 주소를 조용히 내보내지 않는다', async () => {
    delete process.env['RESEND_WEBHOOK_SECRET'];

    await expect(forwardReceivedReply(EVENT)).rejects.toThrow('RESEND_WEBHOOK_SECRET');
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).not.toHaveBeenCalled();
  });

  describe('모양을 바꿔 다시 보낼 때의 시간', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('첨부를 실은 두 모양(중계 주소 → 보낸이 계정 주소)은 발송 제한 시간 하나를 나눠 쓴다 — 실행 시간 제한이 늘지 않는다', async () => {
      const usedByFirst = REPLY_FORWARD_STEP_TIMEOUTS_MS.send - 20_000;
      sendMock
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve(rejection('validation_error', 422)), usedByFirst);
            }),
        )
        .mockImplementationOnce(() => new Promise<never>(() => undefined));

      const settled = forwardReceivedReply(EVENT).then(
        () => 'resolved',
        (err: unknown) => err,
      );
      await vi.advanceTimersByTimeAsync(usedByFirst);
      expect(sendMock).toHaveBeenCalledTimes(2);
      // 둘째 모양에 남은 시간은 20초다 — 제한 시간을 처음부터 다시 주지 않는다.
      await vi.advanceTimersByTimeAsync(20_000 - 1);
      expect(await Promise.race([settled, Promise.resolve('pending')])).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);

      const error = await settled;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('시간 초과');
      expect(recordReplyForwardEvent).not.toHaveBeenCalled();
    });
  });
});

describe('forwardReceivedReply — 답장 중계(담당자의 답장을 응답자에게)', () => {
  const SENT = { data: { id: 'out-1' }, error: null, headers: null };
  const STAFF_PDF_BASE64 = Buffer.from('%PDF-1.4 안내문').toString('base64');

  /** 담당자가 전달 메일에 「답장」을 눌러 쓴 메일 — 받는 사람이 중계 주소다. 참조에 다른 사람이 있다. */
  function staffRaw(options: { headers?: string[]; from?: string; to?: string } = {}): string {
    return [
      `From: ${options.from ?? '=?UTF-8?B?7J2064u064u5?= <lee@example.co.kr>'}`,
      `To: ${options.to ?? `=?UTF-8?B?6rmA7J2R64u1?= <${RELAY_FROM_KIM}>`}`,
      'Cc: boss@example.co.kr',
      'Subject: =?UTF-8?B?UkU6IOyEpOusuOyngCDtmozsi6A=?=',
      ...(options.headers ?? []),
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="mix"',
      '',
      '--mix',
      'Content-Type: multipart/alternative; boundary="alt"',
      '',
      '--alt',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('확인했습니다').toString('base64'),
      '--alt',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('<p>확인했습니다</p>').toString('base64'),
      '--alt--',
      '--mix',
      'Content-Type: application/pdf; name="guide.pdf"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="guide.pdf"',
      '',
      STAFF_PDF_BASE64,
      '--mix--',
      '',
    ].join('\r\n');
  }

  function staffEmail(overrides: ReceivedOverrides = {}) {
    return receivedEmail({
      from: '이담당 <lee@example.co.kr>',
      received_for: [RELAY_FROM_KIM],
      subject: 'RE: 설문지 회신',
      ...overrides,
    });
  }

  function rejection(name: string, statusCode: number | null, message = 'rejected') {
    return { data: null, error: { name, statusCode, message }, headers: null };
  }

  function sentRequestAt(index: number) {
    const call = sendMock.mock.calls[index];
    if (!call) throw new Error(`${index + 1}번째 발송 요청이 없다`);
    return { mail: call[0] as Record<string, unknown>, options: call[1] as Record<string, unknown> };
  }

  /** 넘기지 않은 것은 정상 처리다 — 발송이 없고, 장부에 「넘기지 않음」으로 적힌다. */
  function expectNotRelayed(result: unknown, reason: string) {
    expect(result).toEqual({ outcome: 'skipped', reason });
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'skipped');
  }

  beforeEach(() => {
    // 기본: 계정 survey 의 회신 주소는 help@example.co.kr — 담당자(lee@example.co.kr)는 회사 도메인이다.
    getMock.mockResolvedValue(staffEmail());
    fetchMock.mockImplementation(async () => rawResponse(staffRaw()));
  });

  it('담당자의 답장 한 통을 중계 주소가 가리키는 응답자에게 받은 그대로 넘긴다', async () => {
    const result = await forwardReceivedReply(EVENT);

    expect(result).toEqual({ outcome: 'relayed', relayCount: 1, alreadySent: false });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const { mail, options } = sentRequest();
    expect(mail).toEqual({
      // 담당자가 쓴 이름 + 보낸이 계정 주소(중계 꼬리 없음).
      from: '이담당 <survey@send.example.co.kr>',
      to: ['kim@corp.co.kr'],
      replyTo: ['lee@example.co.kr'],
      subject: 'RE: 설문지 회신',
      html: '<p>확인했습니다</p>',
      text: '확인했습니다',
      attachments: [{ filename: 'guide.pdf', content: STAFF_PDF_BASE64, contentType: 'application/pdf' }],
      // 자체 표식만 — 사람이 쓴 답장이라 Auto-Submitted 는 붙이지 않는다.
      headers: { 'X-Survey-Reply-Forward': '1' },
      tags: [{ name: 'kind', value: 'reply-relay' }],
    });
    // 멱등 키는 회신 전달과 겹치지 않는다.
    expect(options).toEqual({ idempotencyKey: 'reply-relay/recv-1' });
    expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
    expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'relayed');
  });

  it('원본의 참조·다른 받는 사람·회신 주소에게는 보내지 않는다', async () => {
    getMock.mockResolvedValue(
      staffEmail({ received_for: [RELAY_FROM_KIM, 'boss@example.co.kr', 'survey@send.example.co.kr'] }),
    );

    await forwardReceivedReply(EVENT);

    const { mail } = sentRequest();
    expect(mail['to']).toEqual(['kim@corp.co.kr']);
    expect(mail).not.toHaveProperty('cc');
    expect(mail).not.toHaveProperty('bcc');
    const serialized = JSON.stringify(mail);
    expect(serialized).not.toContain('boss@example.co.kr');
    expect(serialized).not.toContain('help@example.co.kr');
  });

  it('담당자의 메일에 답장 주소가 따로 있으면 응답자의 「답장」이 그 주소로 간다', async () => {
    getMock.mockResolvedValue(staffEmail({ reply_to: ['조사팀 <team@example.co.kr>'] }));

    await forwardReceivedReply(EVENT);

    expect(sentRequest().mail['replyTo']).toEqual(['team@example.co.kr']);
  });

  it('담당자가 이름 없이 보냈으면 보낸 사람 이름 자리에 담당자 주소를 쓴다', async () => {
    getMock.mockResolvedValue(staffEmail({ from: 'lee@example.co.kr' }));
    fetchMock.mockImplementation(async () => rawResponse(staffRaw({ from: 'lee@example.co.kr' })));

    await forwardReceivedReply(EVENT);

    expect(sentRequest().mail['from']).toBe('"lee@example.co.kr" <survey@send.example.co.kr>');
  });

  it('메일 시스템이 중계 주소를 소문자·대문자로 바꿔도 넘긴다', async () => {
    getMock.mockResolvedValue(staffEmail({ received_for: [RELAY_FROM_KIM.toUpperCase()] }));

    const result = await forwardReceivedReply(EVENT);

    expect(result).toMatchObject({ outcome: 'relayed', relayCount: 1 });
    expect(sentRequest().mail['to']).toEqual(['KIM@CORP.CO.KR']);
    expect(sentRequest().mail['from']).toBe('이담당 <survey@send.example.co.kr>');
  });

  describe('중계 대상이 여럿이면 응답자마다 한 통씩 보낸다', () => {
    // printf '%s' 'reply-relay:v1:panel:park@other.co.kr' | openssl dgst -sha256 -hmac 'test-relay-secret' → 9d39a32c6b
    const RELAY_PANEL_PARK = 'panel+park=other.co.kr=9d39a32c6b@send.example.co.kr';
    /**
     * 통마다 멱등 키에 붙는 대상 조각 — 코드가 아니라 openssl 로 따로 계산한 글자다:
     *   printf '%s' 'reply-relay-target:v1:park@other.co.kr' | openssl dgst -sha256 -hmac 'test-relay-secret'  → 앞 10자
     */
    const KEY_PARK = 'reply-relay/recv-1/to-4158e183fe';
    const KEY_KIM = 'reply-relay/recv-1/to-84c37c0a92';

    beforeEach(() => {
      // 같은 응답자의 중계 주소가 대소문자만 달리 두 번 와도 대상은 둘이다(park · kim).
      getMock.mockResolvedValue(
        staffEmail({ received_for: [RELAY_PANEL_PARK, RELAY_FROM_KIM, RELAY_FROM_KIM.toUpperCase()] }),
      );
    });

    it('받는 사람은 언제나 한 명이다 — 응답자끼리 서로의 주소를 보지 못한다', async () => {
      const result = await forwardReceivedReply(EVENT);

      expect(sendMock).toHaveBeenCalledTimes(2);
      const toPark = sentRequestAt(0).mail;
      const toKim = sentRequestAt(1).mail;
      expect(toPark['to']).toEqual(['park@other.co.kr']);
      expect(toKim['to']).toEqual(['kim@corp.co.kr']);
      for (const mail of [toPark, toKim]) {
        expect(mail).not.toHaveProperty('cc');
        expect(mail).not.toHaveProperty('bcc');
      }
      expect(JSON.stringify(toPark)).not.toContain('kim@corp.co.kr');
      expect(JSON.stringify(toKim)).not.toContain('park@other.co.kr');
      // 내용은 같다 — 받는 사람과 보낸 사람 주소의 계정만 다르다.
      expect({ ...toPark, to: null, from: null }).toEqual({ ...toKim, to: null, from: null });
      expect(result).toEqual({ outcome: 'relayed', relayCount: 2, alreadySent: false });
    });

    it('통마다 보낸 사람 주소의 계정은 그 중계 주소에 담겨 있던 계정이다', async () => {
      await forwardReceivedReply(EVENT);

      expect(sentRequestAt(0).mail['from']).toBe('이담당 <panel@send.example.co.kr>');
      expect(sentRequestAt(1).mail['from']).toBe('이담당 <survey@send.example.co.kr>');
    });

    it('통마다 멱등 키가 다르다 — 주소가 아니라 대상에서 뽑은 조각을 붙인다', async () => {
      await forwardReceivedReply(EVENT);

      expect(sentRequestAt(0).options).toEqual({ idempotencyKey: KEY_PARK });
      expect(sentRequestAt(1).options).toEqual({ idempotencyKey: KEY_KIM });
      for (const fragment of ['park', 'kim', 'corp.co.kr', 'other.co.kr', '9d39a32c6b', '42a7387e98']) {
        expect(`${KEY_PARK} ${KEY_KIM}`).not.toContain(fragment);
      }
    });

    it('같은 대상은 받는 주소의 순서·대소문자가 달라져도 같은 키다 — 순번이 아니다', async () => {
      getMock.mockResolvedValue(
        staffEmail({ received_for: [RELAY_FROM_KIM.toUpperCase(), RELAY_PANEL_PARK.toUpperCase()] }),
      );

      await forwardReceivedReply(EVENT);

      expect(sentRequestAt(0).mail['to']).toEqual(['KIM@CORP.CO.KR']);
      expect(sentRequestAt(0).options).toEqual({ idempotencyKey: KEY_KIM });
      expect(sentRequestAt(1).mail['to']).toEqual(['PARK@OTHER.CO.KR']);
      expect(sentRequestAt(1).options).toEqual({ idempotencyKey: KEY_PARK });
    });

    it('대상 조각을 붙일지는 서명이 맞는 중계 주소 수로 정한다 — 회사 도메인 판정으로 대상이 줄어도 키가 바뀌지 않는다', async () => {
      // panel 계정의 회신 주소는 다른 회사다 — 담당자(example.co.kr)의 답장은 kim 에게만 간다.
      vi.mocked(loadAccountReplyAddresses).mockImplementation(async (account) =>
        account === 'panel'
          ? { source: 'template', addresses: ['manager@other-company.co.kr'] }
          : { source: 'campaign', addresses: ['help@example.co.kr'] },
      );

      const result = await forwardReceivedReply(EVENT);

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sentRequest().mail['to']).toEqual(['kim@corp.co.kr']);
      // 재시도 사이 회신 주소가 바뀌어 대상이 둘이 되어도 kim 의 키는 이 값 그대로다(두 통이 나가지 않는다).
      expect(sentRequest().options).toEqual({ idempotencyKey: KEY_KIM });
      expect(result).toEqual({ outcome: 'relayed', relayCount: 1, alreadySent: false });
    });

    it('첨부를 뺀 모양의 키에도 대상 조각이 든다', async () => {
      sendMock.mockImplementation(async (mail: { to: string[]; attachments: unknown[] }) =>
        mail.to[0] === 'park@other.co.kr' && mail.attachments.length > 0
          ? rejection('application_error', 413, 'Request Entity Too Large')
          : SENT,
      );

      const result = await forwardReceivedReply(EVENT);

      expect(sendMock.mock.calls.map((call) => [(call[0] as { to: string[] }).to[0], call[1]])).toEqual([
        ['park@other.co.kr', { idempotencyKey: KEY_PARK }],
        ['park@other.co.kr', { idempotencyKey: `${KEY_PARK}/no-attachments` }],
        ['kim@corp.co.kr', { idempotencyKey: KEY_KIM }],
      ]);
      expect(result).toEqual({ outcome: 'relayed', relayCount: 2, alreadySent: false, attachmentsOmitted: true });
    });

    it('일부만 나간 채 실패하면 실패로 던지고 장부에 적지 않는다 — 재시도는 같은 대상에 같은 키·같은 내용을 쓴다', async () => {
      sendMock.mockResolvedValueOnce(SENT).mockResolvedValueOnce(rejection('application_error', 503));

      await expect(forwardReceivedReply(EVENT)).rejects.toThrow('답장 중계 발송 실패');
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(recordReplyForwardEvent).not.toHaveBeenCalled();

      // Resend 가 알림을 다시 보낸다 — 이미 나간 대상(park)은 같은 키·같은 내용이라 발송 서비스가 두 번 보내지 않는다.
      sendMock.mockResolvedValue(SENT);
      const result = await forwardReceivedReply(EVENT);

      expect(sendMock).toHaveBeenCalledTimes(4);
      expect(sentRequestAt(2)).toEqual(sentRequestAt(0));
      expect(sentRequestAt(3)).toEqual(sentRequestAt(1));
      expect(sentRequestAt(2).options).toEqual({ idempotencyKey: KEY_PARK });
      expect(sentRequestAt(3).options).toEqual({ idempotencyKey: KEY_KIM });
      expect(result).toEqual({ outcome: 'relayed', relayCount: 2, alreadySent: false });
      expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
      expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'relayed');
    });

    it('시간당 자리와 장부 결과 줄은 받은 메일 한 통에 하나다 — 통마다 늘리지 않는다', async () => {
      await forwardReceivedReply(EVENT);

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(reserveForwardSlot).toHaveBeenCalledTimes(1);
      expect(reserveForwardSlot).toHaveBeenCalledWith('svix-1');
      expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
      expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'relayed');
      // 원본도 한 번만 내려받는다.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('로그의 relayCount 는 보낸 통 수다 — 주소는 싣지 않는다', async () => {
      await forwardReceivedReply(EVENT);

      expect(logMock.info).toHaveBeenCalledTimes(1);
      expect(logMock.info.mock.calls[0]?.[0]).toEqual({
        receivedEmailId: 'recv-1',
        outcome: 'relayed',
        relayCount: 2,
      });
      const logged = JSON.stringify([...logMock.info.mock.calls, ...logMock.warn.mock.calls]);
      for (const fragment of ['park', 'kim', 'corp.co.kr', 'other.co.kr', 'lee@example.co.kr']) {
        expect(logged).not.toContain(fragment);
      }
    });

    it('한 대상만 끝내 거절되면 나머지는 보내고 「중계」로 적는다 — relayCount 는 보낸 통 수이고, 못 보낸 것은 Sentry 경고로 알린다', async () => {
      sendMock.mockImplementation(async (mail: { to: string[] }) =>
        mail.to[0] === 'park@other.co.kr'
          ? rejection('validation_error', 422, 'Invalid `to` field: park@other.co.kr')
          : SENT,
      );

      const result = await forwardReceivedReply(EVENT);

      // park: 첨부 실은 모양 → 첨부 없는 모양(둘 다 거절). kim: 한 번에 나간다.
      expect(sendMock.mock.calls.map((call) => (call[0] as { to: string[] }).to[0])).toEqual([
        'park@other.co.kr',
        'park@other.co.kr',
        'kim@corp.co.kr',
      ]);
      expect(result).toEqual({ outcome: 'relayed', relayCount: 1, alreadySent: false, rejectedCount: 1 });
      expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
      expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'relayed');
      expect(sentryMessageMock).toHaveBeenCalledTimes(1);
      expect(sentryMessageMock).toHaveBeenCalledWith('답장 중계 발송 거절 — 넘기지 못함', {
        level: 'warning',
        tags: { operation: 'reply_relay_rejected' },
        extra: {
          receivedEmailId: 'recv-1',
          errorName: 'validation_error',
          statusCode: 422,
          rejectedCount: 1,
          relayCount: 1,
        },
      });
      expect(logMock.warn.mock.calls[0]?.[0]).toEqual({
        receivedEmailId: 'recv-1',
        outcome: 'relayed',
        relayCount: 1,
        rejectedCount: 1,
      });
      const exposed = JSON.stringify([sentryMessageMock.mock.calls, logMock.info.mock.calls, logMock.warn.mock.calls]);
      for (const fragment of ['park', 'kim', 'corp.co.kr', 'other.co.kr', 'lee@example.co.kr', 'Invalid']) {
        expect(exposed).not.toContain(fragment);
      }
    });

    it('전원이 끝내 거절되면 「넘기지 않음」으로 적고 Sentry 경고를 한 번 낸다', async () => {
      sendMock.mockResolvedValue(rejection('validation_error', 422));

      const result = await forwardReceivedReply(EVENT);

      expect(sendMock).toHaveBeenCalledTimes(4);
      expect(result).toEqual({ outcome: 'skipped', reason: 'send_rejected' });
      expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
      expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'skipped');
      expect(sentryMessageMock).toHaveBeenCalledTimes(1);
      expect(sentryMessageMock).toHaveBeenCalledWith('답장 중계 발송 거절 — 넘기지 못함', {
        level: 'warning',
        tags: { operation: 'reply_relay_rejected' },
        extra: { receivedEmailId: 'recv-1', errorName: 'validation_error', statusCode: 422 },
      });
    });

    it('한 통이라도 「같은 멱등 키에 내용이 다르다」로 거절되면 Sentry 경고는 한 번이다', async () => {
      sendMock.mockResolvedValue(rejection('invalid_idempotent_request', 409, 'payload mismatch'));

      const result = await forwardReceivedReply(EVENT);

      expect(result).toEqual({ outcome: 'relayed', relayCount: 2, alreadySent: true });
      expect(sentryMessageMock).toHaveBeenCalledTimes(1);
    });

    describe('시간', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('여러 통이 발송 제한 시간 하나를 나눠 쓴다 — 통마다 제한 시간을 새로 주지 않아 실행 시간 제한이 늘지 않는다', async () => {
        const usedByFirst = REPLY_FORWARD_STEP_TIMEOUTS_MS.send - 20_000;
        sendMock
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                setTimeout(() => resolve(SENT), usedByFirst);
              }),
          )
          .mockImplementationOnce(() => new Promise<never>(() => undefined));

        const settled = forwardReceivedReply(EVENT).then(
          () => 'resolved',
          (err: unknown) => err,
        );
        await vi.advanceTimersByTimeAsync(usedByFirst);
        expect(sendMock).toHaveBeenCalledTimes(2);
        // 둘째 통에 남은 시간은 20초다.
        await vi.advanceTimersByTimeAsync(20_000 - 1);
        expect(await Promise.race([settled, Promise.resolve('pending')])).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);

        const error = await settled;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('시간 초과');
        expect(recordReplyForwardEvent).not.toHaveBeenCalled();
      });
    });
  });

  describe('회사 도메인 판정의 재료는 그 계정의 계정 기준 회신 주소다', () => {
    /** 담당자(lee)가 survey 계정의 어느 회차(테스트 회차 등) 수신자였고, 그 회차의 회신 주소는 외부 업체다. */
    function staffWasRecipientOfVendorCampaign() {
      vi.mocked(findReplyAddressByRespondent).mockImplementation(async (_account, address) =>
        address.toLowerCase() === 'lee@example.co.kr'
          ? { source: 'respondent', addresses: ['vendor@partner.co.kr'] }
          : { source: null, addresses: [] },
      );
    }

    it('담당자 주소가 그 계정 회차의 수신자이고 그 회차의 회신 주소가 외부 도메인이어도 응답자에게 중계한다 — 그 회신 주소로 회신 전달하지 않는다', async () => {
      staffWasRecipientOfVendorCampaign();

      const result = await forwardReceivedReply(EVENT);

      expect(result).toEqual({ outcome: 'relayed', relayCount: 1, alreadySent: false });
      expect(sendMock).toHaveBeenCalledTimes(1);
      const { mail, options } = sentRequest();
      expect(mail['to']).toEqual(['kim@corp.co.kr']);
      expect(mail['tags']).toEqual([{ name: 'kind', value: 'reply-relay' }]);
      expect(JSON.stringify(mail)).not.toContain('vendor@partner.co.kr');
      expect(options).toEqual({ idempotencyKey: 'reply-relay/recv-1' });
      expect(recordReplyForwardEvent).toHaveBeenCalledTimes(1);
      expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'relayed');
    });

    it('알림에 받는 주소·보낸 사람이 실려 와도(미리 거르기를 거쳐도) 같다', async () => {
      staffWasRecipientOfVendorCampaign();

      const result = await forwardReceivedReply({
        ...EVENT,
        receivedFor: [RELAY_FROM_KIM],
        from: '이담당 <lee@example.co.kr>',
      });

      expect(result).toEqual({ outcome: 'relayed', relayCount: 1, alreadySent: false });
      expect(sentRequest().mail['to']).toEqual(['kim@corp.co.kr']);
    });

    it('어느 중계 대상을 남길지도 계정마다 계정 기준 회신 주소로 본다', async () => {
      // 담당자가 panel 계정 회차의 수신자였고 그 회차의 회신 주소는 외부 업체다. panel 계정이 쓰는 회신 주소에는 회사 도메인이 있다.
      vi.mocked(findReplyAddressByRespondent).mockImplementation(async (account) =>
        account === 'panel'
          ? { source: 'respondent', addresses: ['vendor@partner.co.kr'] }
          : { source: null, addresses: [] },
      );
      vi.mocked(loadAccountReplyAddresses).mockImplementation(async (account) =>
        account === 'panel'
          ? { source: 'campaign', addresses: ['vendor@partner.co.kr', 'panel-help@example.co.kr'] }
          : { source: 'campaign', addresses: ['help@example.co.kr'] },
      );
      getMock.mockResolvedValue(
        staffEmail({ received_for: ['panel+park=other.co.kr=9d39a32c6b@send.example.co.kr', RELAY_FROM_KIM] }),
      );

      const result = await forwardReceivedReply(EVENT);

      expect(result).toEqual({ outcome: 'relayed', relayCount: 2, alreadySent: false });
      expect(sendMock.mock.calls.map((call) => (call[0] as { to: string[] }).to)).toEqual([
        ['park@other.co.kr'],
        ['kim@corp.co.kr'],
      ]);
    });

    it('응답자 주소로 좁힌 회신 주소가 보낸 사람과 같은 도메인이어도, 그 계정이 쓰는 회신 주소에 그 도메인이 없으면 중계하지 않는다', async () => {
      // 보낸 사람(gmail)이 survey 계정의 오래된 회차 수신자였고 그 회차의 회신 주소가 gmail 이었다 — 지금 그 계정이 쓰는 회신 주소는 회사 도메인뿐이다.
      vi.mocked(findReplyAddressByRespondent).mockResolvedValue({
        source: 'respondent',
        addresses: ['manager@gmail.com'],
      });
      getMock.mockResolvedValue(staffEmail({ from: '누군가 <someone@gmail.com>' }));

      // 중계 길에 들지 못하고, 서명이 맞는 중계 주소가 없는 메일과 같은 판정으로 간다(회사 도메인에서 온 메일).
      expectNotRelayed(await forwardReceivedReply(EVENT), 'company_domain');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each<[string, string]>([
      ['중계 꼬리 없는 계정 주소', 'survey@send.example.co.kr'],
      ['서명이 틀린 중계 주소', 'survey+kim=corp.co.kr=0000000000@send.example.co.kr'],
    ])('서명이 맞는 중계 주소가 없는 메일(%s)의 판정은 그대로다 — 응답자 주소로 찾은 회신 주소로 회신 전달한다', async (_name, address) => {
      staffWasRecipientOfVendorCampaign();
      getMock.mockResolvedValue(staffEmail({ received_for: [address] }));

      const result = await forwardReceivedReply(EVENT);

      expect(result).toMatchObject({ outcome: 'forwarded', forwardCount: 1, sources: ['respondent'] });
      const { mail, options } = sentRequest();
      expect(mail['to']).toEqual(['vendor@partner.co.kr']);
      expect(mail['tags']).toEqual([{ name: 'kind', value: 'reply-forward' }]);
      expect(options).toEqual({ idempotencyKey: 'reply-forward/recv-1' });
    });

    it('회사 밖에서 서명이 맞는 중계 주소로 온 메일은 지금처럼 그 계정의 회신 전달이다 — 응답자 주소로 찾은 회신 주소 한 곳으로', async () => {
      vi.mocked(findReplyAddressByRespondent).mockResolvedValue({
        source: 'respondent',
        addresses: ['team-b@example.co.kr'],
      });
      vi.mocked(loadAccountReplyAddresses).mockResolvedValue({
        source: 'campaign',
        addresses: ['help@example.co.kr', 'team-b@example.co.kr'],
      });
      getMock.mockResolvedValue(staffEmail({ from: '박응답 <park@other.co.kr>' }));

      const result = await forwardReceivedReply(EVENT);

      expect(result).toMatchObject({ outcome: 'forwarded', forwardCount: 1, sources: ['respondent'] });
      expect(sentRequest().mail['to']).toEqual(['team-b@example.co.kr']);
    });
  });

  describe('받는 사람은 서명이 맞는 중계 주소에서만 나온다', () => {
    it.each<[string, string]>([
      ['서명 위조', 'survey+victim=elsewhere.com=0000000000@send.example.co.kr'],
      ['다른 응답자의 서명을 옮겨 붙임', 'survey+victim=elsewhere.com=42a7387e98@send.example.co.kr'],
      ['다른 계정의 서명', 'panel+kim=corp.co.kr=42a7387e98@send.example.co.kr'],
      ['잘린 서명', 'survey+kim=corp.co.kr=42a7387e9@send.example.co.kr'],
      ['서명 없는 꼬리', 'survey+kim=corp.co.kr@send.example.co.kr'],
    ])('%s — 꼬리를 무시하고 계정만 본다. 회사 도메인에서 온 메일이라 넘기지 않는다', async (_name, address) => {
      getMock.mockResolvedValue(staffEmail({ received_for: [address] }));
      // 원본의 받는 사람·참조·답장 주소에 무엇이 적혀 있든 받는 사람이 되지 않는다.
      fetchMock.mockImplementation(async () => rawResponse(staffRaw({ to: 'victim@elsewhere.com' })));

      expectNotRelayed(await forwardReceivedReply(EVENT), 'company_domain');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(reserveForwardSlot).not.toHaveBeenCalled();
    });

    it('맞는 것과 틀린 것이 섞여 있으면 맞는 것에만 보낸다', async () => {
      getMock.mockResolvedValue(
        staffEmail({
          received_for: ['survey+victim=elsewhere.com=0000000000@send.example.co.kr', RELAY_FROM_KIM],
        }),
      );

      await forwardReceivedReply(EVENT);

      expect(sentRequest().mail['to']).toEqual(['kim@corp.co.kr']);
    });

    it('회사 도메인 판정은 그 중계 주소의 계정으로 한다 — 다른 계정의 회신 주소와 같은 도메인이라고 중계하지 않는다', async () => {
      // survey 계정의 회신 주소는 회사 도메인, panel 계정의 회신 주소는 외부 메일(gmail)이다.
      vi.mocked(loadAccountReplyAddresses).mockImplementation(async (account) =>
        account === 'panel'
          ? { source: 'template', addresses: ['manager@gmail.com'] }
          : { source: 'campaign', addresses: ['help@example.co.kr'] },
      );
      // gmail 사용자가 survey 계정의 중계 주소와 panel 계정 주소를 함께 받는 사람에 넣었다.
      getMock.mockResolvedValue(
        staffEmail({
          from: '누군가 <someone@gmail.com>',
          received_for: [RELAY_FROM_KIM, 'panel@send.example.co.kr'],
        }),
      );

      expectNotRelayed(await forwardReceivedReply(EVENT), 'company_domain');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('중계 주소가 여럿이면 보낸 사람이 회사 도메인인 계정의 것만 넘긴다', async () => {
      vi.mocked(loadAccountReplyAddresses).mockImplementation(async (account) =>
        account === 'panel'
          ? { source: 'template', addresses: ['manager@other-company.co.kr'] }
          : { source: 'campaign', addresses: ['help@example.co.kr'] },
      );
      getMock.mockResolvedValue(
        staffEmail({ received_for: ['panel+park=other.co.kr=9d39a32c6b@send.example.co.kr', RELAY_FROM_KIM] }),
      );

      const result = await forwardReceivedReply(EVENT);

      expect(result).toEqual({ outcome: 'relayed', relayCount: 1, alreadySent: false });
      expect(sentRequest().mail['to']).toEqual(['kim@corp.co.kr']);
      expect(sentRequest().mail['from']).toBe('이담당 <survey@send.example.co.kr>');
    });

    it('회사 도메인에서 중계 꼬리 없는 계정 주소로 온 메일은 지금처럼 넘기지 않는다', async () => {
      getMock.mockResolvedValue(staffEmail({ received_for: ['survey@send.example.co.kr'] }));

      expectNotRelayed(await forwardReceivedReply(EVENT), 'company_domain');
    });

    it('키가 바뀌면 이미 나간 중계 주소는 죽는다 — 넘기지 않는다', async () => {
      process.env['RESEND_WEBHOOK_SECRET'] = 'rotated-secret';

      expectNotRelayed(await forwardReceivedReply(EVENT), 'company_domain');
    });
  });

  describe('자동으로 만들어진 메일은 중계하지 않는다', () => {
    it.each<[string, string]>([
      ['부재중 자동응답', 'Auto-Submitted: auto-replied'],
      ['자동 생성', 'Auto-Submitted: auto-generated'],
      ['X-Autoreply', 'X-Autoreply: yes'],
      ['X-Autorespond', 'X-Autorespond: out of office'],
      ['Precedence: bulk', 'Precedence: bulk'],
      ['Precedence: junk', 'Precedence: junk'],
      ['Precedence: auto_reply', 'Precedence: auto_reply'],
    ])('%s — 회사 메일함의 자동응답이 응답자에게 가지 않는다', async (_name, header) => {
      fetchMock.mockImplementation(async () => rawResponse(staffRaw({ headers: [header] })));

      expectNotRelayed(await forwardReceivedReply(EVENT), 'auto_generated');
    });

    it('조회 응답의 헤더에 자동 메일 표식이 보이면 원본을 내려받기 전에, 자리도 잡지 않고 끝낸다', async () => {
      getMock.mockResolvedValue(staffEmail({ headers: { 'auto-submitted': 'auto-replied' } }));

      expectNotRelayed(await forwardReceivedReply(EVENT), 'auto_generated');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(reserveForwardSlot).not.toHaveBeenCalled();
    });

    it('Auto-Submitted: no 는 사람이 쓴 메일이다 — 넘긴다', async () => {
      fetchMock.mockImplementation(async () => rawResponse(staffRaw({ headers: ['Auto-Submitted: no'] })));

      expect(await forwardReceivedReply(EVENT)).toMatchObject({ outcome: 'relayed' });
    });

    it('우리 표식 헤더를 단 메일(전달 메일이 자동 전달로 되돌아옴)은 중계하지 않는다', async () => {
      fetchMock.mockImplementation(async () => rawResponse(staffRaw({ headers: ['X-Survey-Reply-Forward: 1'] })));

      expectNotRelayed(await forwardReceivedReply(EVENT), 'forward_loop');
    });

    it('회사 메일 서버의 배달 상태 통지는 중계하지 않는다', async () => {
      getMock.mockResolvedValue(staffEmail({ from: 'Mail Delivery System <MAILER-DAEMON@example.co.kr>' }));

      expectNotRelayed(await forwardReceivedReply(EVENT), 'delivery_report');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('걸러진 건의 로그에 주소·이름·제목을 싣지 않는다', async () => {
      fetchMock.mockImplementation(async () => rawResponse(staffRaw({ headers: ['Auto-Submitted: auto-replied'] })));

      await forwardReceivedReply(EVENT);

      expect(logMock.info.mock.calls[0]?.[0]).toEqual({
        receivedEmailId: 'recv-1',
        outcome: 'skipped',
        reason: 'auto_generated',
        forwardCount: 0,
      });
      const logged = JSON.stringify([...logMock.info.mock.calls, ...logMock.warn.mock.calls]);
      for (const fragment of ['lee@example.co.kr', 'kim', 'corp.co.kr', '이담당', '설문지 회신']) {
        expect(logged).not.toContain(fragment);
      }
    });
  });

  describe('회신 전달과 같은 장치를 탄다', () => {
    it('알림 값으로 미리 거를 때도 + 뒤를 떼고 본다 — 중계 주소로 온 메일이 「쓴 적 없는 계정」으로 버려지지 않는다', async () => {
      const result = await forwardReceivedReply({
        ...EVENT,
        receivedFor: [RELAY_FROM_KIM],
        from: '이담당 <lee@example.co.kr>',
      });

      expect(result).toMatchObject({ outcome: 'relayed' });
      expect(loadAccountReplyAddresses).toHaveBeenCalledWith('survey', expect.anything());
      // 알림 값과 조회한 값이 같으니 회신 주소는 한 번만 찾는다.
      expect(loadAccountReplyAddresses).toHaveBeenCalledTimes(1);
    });

    it('쓴 적 없는 계정의 중계 주소 모양으로 온 메일은 조회 없이 넘기지 않는다', async () => {
      vi.mocked(loadAccountReplyAddresses).mockResolvedValue({ source: null, addresses: [] });

      const result = await forwardReceivedReply({
        ...EVENT,
        receivedFor: ['ghost+kim=corp.co.kr=42a7387e98@send.example.co.kr'],
        from: '이담당 <lee@example.co.kr>',
      });

      expect(result).toEqual({ outcome: 'skipped', reason: 'unused_sender_account' });
      expect(getMock).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('이미 처리한 알림은 다시 넘기지 않는다', async () => {
      vi.mocked(isWebhookEventRecorded).mockResolvedValue(true);

      expect(await forwardReceivedReply(EVENT)).toEqual({ outcome: 'deduped' });
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('시간당 자리를 발송 전에 잡는다 — 회신 전달과 같은 상한을 나눠 쓴다', async () => {
      await forwardReceivedReply(EVENT);

      expect(reserveForwardSlot).toHaveBeenCalledTimes(1);
      expect(reserveForwardSlot).toHaveBeenCalledWith('svix-1');
      const slotOrder = vi.mocked(reserveForwardSlot).mock.invocationCallOrder[0] ?? 0;
      expect(slotOrder).toBeLessThan(fetchMock.mock.invocationCallOrder[0] ?? 0);
      expect(slotOrder).toBeLessThan(sendMock.mock.invocationCallOrder[0] ?? 0);
    });

    it('자리를 못 잡으면 넘기지 않고 실패로 던진다 — 장부에 적지 않아 재시도가 뒤로 미룬다', async () => {
      vi.mocked(reserveForwardSlot).mockResolvedValue({ reserved: false, slotsInWindow: REPLY_FORWARD_HOURLY_CAP });

      await expect(forwardReceivedReply(EVENT)).rejects.toBeInstanceOf(ReplyForwardCapExceeded);
      expect(sendMock).not.toHaveBeenCalled();
      expect(recordReplyForwardEvent).not.toHaveBeenCalled();
    });

    it('큰 첨부: 발송 API 가 크기 초과로 거절하면 첨부 없이 한 번 더 보낸다 — 안내는 응답자에게 하는 말이다', async () => {
      sendMock.mockResolvedValueOnce(rejection('application_error', 413, 'Request Entity Too Large')).mockResolvedValueOnce(SENT);

      const result = await forwardReceivedReply(EVENT);

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sentRequestAt(0).options).toEqual({ idempotencyKey: 'reply-relay/recv-1' });
      const second = sentRequestAt(1);
      expect(second.options).toEqual({ idempotencyKey: 'reply-relay/recv-1/no-attachments' });
      expect(second.mail['attachments']).toEqual([]);
      for (const body of [String(second.mail['html']), String(second.mail['text'])]) {
        expect(body).toContain('첨부 파일이 커서 함께 전달하지 못했습니다');
        expect(body).toContain('guide.pdf');
        expect(body).toContain('보낸 사람에게 파일을 다시 요청해 주세요');
        expect(body).not.toContain('Resend');
      }
      expect(String(second.mail['text']).endsWith('확인했습니다')).toBe(true);
      expect(second.mail).toMatchObject({
        from: '이담당 <survey@send.example.co.kr>',
        to: ['kim@corp.co.kr'],
        replyTo: ['lee@example.co.kr'],
        tags: [{ name: 'kind', value: 'reply-relay' }],
      });
      expect(result).toEqual({ outcome: 'relayed', relayCount: 1, alreadySent: false, attachmentsOmitted: true });
      expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'relayed');
    });

    it('다시 해도 안 되는 거절: 첨부 없이 한 번 물러나고, 그것도 거절되면 「넘기지 않음」으로 적고 Sentry 경고를 낸다', async () => {
      sendMock.mockResolvedValue(rejection('validation_error', 422, 'Invalid `to` field: kim@corp.co.kr'));

      const result = await forwardReceivedReply(EVENT);

      // 보낸 사람 주소가 보낸이 계정 그대로라 물러날 모양은 첨부 없음 하나뿐이다.
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sentRequestAt(1).options).toEqual({ idempotencyKey: 'reply-relay/recv-1/no-attachments' });
      expect(String(sentRequestAt(1).mail['text'])).toContain('첨부 파일을 함께 전달하지 못했습니다');
      expect(result).toEqual({ outcome: 'skipped', reason: 'send_rejected' });
      expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'skipped');
      expect(sentryMessageMock).toHaveBeenCalledTimes(1);
      expect(sentryMessageMock).toHaveBeenCalledWith('답장 중계 발송 거절 — 넘기지 못함', {
        level: 'warning',
        tags: { operation: 'reply_relay_rejected' },
        extra: { receivedEmailId: 'recv-1', errorName: 'validation_error', statusCode: 422 },
      });
      const exposed = JSON.stringify([sentryMessageMock.mock.calls, logMock.info.mock.calls, logMock.warn.mock.calls]);
      for (const fragment of ['kim', 'corp.co.kr', 'lee@example.co.kr', 'Invalid']) {
        expect(exposed).not.toContain(fragment);
      }
    });

    it('일시 장애는 실패로 던진다 — 장부에 적지 않아 재시도가 멱등 키로 이어 간다', async () => {
      sendMock.mockResolvedValue(rejection('application_error', 503));

      await expect(forwardReceivedReply(EVENT)).rejects.toThrow('답장 중계 발송 실패');
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(recordReplyForwardEvent).not.toHaveBeenCalled();
    });

    it('「같은 멱등 키에 내용이 다르다」 거절은 이미 보낸 것으로 보고 Sentry 경고를 낸다', async () => {
      sendMock.mockResolvedValue(rejection('invalid_idempotent_request', 409, 'payload mismatch'));

      const result = await forwardReceivedReply(EVENT);

      expect(result).toEqual({ outcome: 'relayed', relayCount: 1, alreadySent: true });
      expect(recordReplyForwardEvent).toHaveBeenCalledWith('svix-1', 'relayed');
      expect(sentryMessageMock).toHaveBeenCalledWith('답장 중계 멱등 키 내용 불일치 — 발송 여부 확인 필요', {
        level: 'warning',
        tags: { operation: 'reply_relay_idempotency_mismatch' },
        extra: { receivedEmailId: 'recv-1' },
      });
    });
  });

  it('로그 결과 줄은 relayed 로 갈리고, 주소·이름·제목·본문을 싣지 않는다', async () => {
    await forwardReceivedReply(EVENT);

    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info.mock.calls[0]?.[0]).toEqual({
      receivedEmailId: 'recv-1',
      outcome: 'relayed',
      relayCount: 1,
    });
    const logged = JSON.stringify([
      ...logMock.info.mock.calls,
      ...logMock.warn.mock.calls,
      ...logMock.error.mock.calls,
    ]);
    for (const fragment of ['lee@example.co.kr', 'kim', 'corp.co.kr', 'example.co.kr', '이담당', '설문지 회신', '확인했습니다', 'guide.pdf']) {
      expect(logged).not.toContain(fragment);
    }
  });
});
