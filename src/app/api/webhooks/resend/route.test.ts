import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { processMock, forwardMock, captureMock, verified } = vi.hoisted(() => ({
  processMock: vi.fn(),
  forwardMock: vi.fn(),
  captureMock: vi.fn(),
  verified: { payload: {} as Record<string, unknown> },
}));

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({
  captureException: captureMock,
  captureMessage: vi.fn(),
}));
vi.mock('svix', () => ({
  Webhook: class {
    verify() {
      return verified.payload;
    }
  },
}));
vi.mock('@/server/mail/services/resend-webhook', () => ({
  processResendWebhookEvent: processMock,
}));
vi.mock('@/server/mail/services/reply-forward', () => ({
  forwardReceivedReply: forwardMock,
}));

import { POST } from '@/app/api/webhooks/resend/route';
import { markSentryCaptured } from '@/server/rpc-error-policy';

const STATUS_EVENT = {
  type: 'email.delivered',
  created_at: '2026-07-22T01:00:00Z',
  data: { email_id: 'message-1' },
};

/** 보낸 사람 주소로 메일이 들어왔다는 알림 — 응답자 주소·제목이 함께 실려 온다. */
const RECEIVED_EVENT = {
  type: 'email.received',
  created_at: '2026-11-12T01:00:00Z',
  data: {
    email_id: 'received-1',
    from: '김응답 <kim@corp.co.kr>',
    to: ['survey@send.example.co.kr'],
    received_for: ['survey@send.example.co.kr'],
    subject: '설문지 회신',
  },
};

function webhookRequest(): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/resend', {
    method: 'POST',
    body: '{}',
    headers: {
      'svix-id': 'svix-event-1',
      'svix-timestamp': '1',
      'svix-signature': 'signature',
    },
  });
}

describe('Resend webhook route retry response', () => {
  beforeEach(() => {
    process.env['RESEND_WEBHOOK_SECRET'] = 'test-secret';
    processMock.mockReset();
    forwardMock.mockReset();
    captureMock.mockReset();
    verified.payload = STATUS_EVENT;
  });

  it('transaction 처리 실패를 non-2xx로 반환해 provider retry를 요청한다', async () => {
    processMock.mockRejectedValueOnce(new Error('transient db failure'));

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
    expect(captureMock).toHaveBeenCalledOnce();
  });

  it('상태 알림은 수신자 전이 경로로 가고 회신 전달을 부르지 않는다', async () => {
    processMock.mockResolvedValueOnce('processed');

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(processMock).toHaveBeenCalledOnce();
    expect(forwardMock).not.toHaveBeenCalled();
  });
});

describe('Resend webhook route — 받은 메일 알림(email.received)', () => {
  beforeEach(() => {
    process.env['RESEND_WEBHOOK_SECRET'] = 'test-secret';
    processMock.mockReset();
    forwardMock.mockReset();
    captureMock.mockReset();
    verified.payload = RECEIVED_EVENT;
  });

  it('회신 전달 서비스로 가고 수신자 상태 전이 경로를 타지 않는다', async () => {
    forwardMock.mockResolvedValueOnce({
      outcome: 'forwarded',
      forwardCount: 1,
      sources: ['campaign'],
      alreadySent: false,
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, replyForward: 'forwarded' });
    expect(forwardMock).toHaveBeenCalledOnce();
    // 알림에 실린 받는 주소·보낸 사람은 넘긴다 — 서비스가 받은 메일을 조회하기 전에 넘기지 않을 메일을 거른다.
    // 제목·참조 같은 나머지는 넘기지 않는다.
    expect(forwardMock).toHaveBeenCalledWith({
      eventId: 'svix-event-1',
      receivedEmailId: 'received-1',
      receivedFor: ['survey@send.example.co.kr'],
      from: '김응답 <kim@corp.co.kr>',
    });
    expect(JSON.stringify(forwardMock.mock.calls)).not.toContain('설문지 회신');
    expect(processMock).not.toHaveBeenCalled();
  });

  it('알림에 받는 주소·보낸 사람이 없거나 모양이 다르면 그 칸을 넘기지 않는다 — 서비스가 조회 뒤에 판정한다', async () => {
    verified.payload = {
      type: 'email.received',
      created_at: '2026-11-12T01:00:00Z',
      data: { email_id: 'received-1', from: { name: '김응답' }, received_for: 'survey@send.example.co.kr' },
    };
    forwardMock.mockResolvedValueOnce({ outcome: 'skipped', reason: 'no_sender_account' });

    await POST(webhookRequest());

    expect(forwardMock).toHaveBeenCalledWith({ eventId: 'svix-event-1', receivedEmailId: 'received-1' });
  });

  it('넘기지 않은 메일도 200 이다 — 실패가 아니라 정상 처리', async () => {
    forwardMock.mockResolvedValueOnce({ outcome: 'skipped', reason: 'unused_sender_account' });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, replyForward: 'skipped' });
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('회신 전달 실패는 500 으로 답해 재시도를 요청하고, Sentry 에 주소·제목을 싣지 않는다', async () => {
    forwardMock.mockRejectedValueOnce(new Error('회신 전달 발송 실패 — application_error (500)'));

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
    expect(processMock).not.toHaveBeenCalled();
    expect(captureMock).toHaveBeenCalledOnce();
    const captured = JSON.stringify(captureMock.mock.calls[0]?.[1]);
    expect(captured).toContain('received-1');
    expect(captured).not.toContain('kim@corp.co.kr');
    expect(captured).not.toContain('설문지 회신');
  });

  it('시간당 상한 초과는 500 으로 답해 재시도에 맡기고, 서비스가 이미 경고로 보낸 오류를 Sentry 에 또 보내지 않는다', async () => {
    // 서비스가 Sentry 경고를 낸 뒤 표식을 달아 던진다(reply-forward 의 ReplyForwardCapExceeded).
    const capExceeded = new Error('회신 전달 시간당 상한 초과');
    markSentryCaptured(capExceeded);
    forwardMock.mockRejectedValueOnce(capExceeded);

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
    expect(captureMock).not.toHaveBeenCalled();
    expect(processMock).not.toHaveBeenCalled();
  });

  it('받은 메일 id 가 없는 알림은 회신 전달을 부르지 않고 기존 경로가 「지원하지 않는 이벤트」로 끝낸다', async () => {
    verified.payload = { type: 'email.received', created_at: '2026-11-12T01:00:00Z', data: {} };
    processMock.mockResolvedValueOnce('ignored');

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(forwardMock).not.toHaveBeenCalled();
    expect(processMock).toHaveBeenCalledOnce();
  });
});
