import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { processMock, captureMock, verified } = vi.hoisted(() => ({
  processMock: vi.fn(),
  captureMock: vi.fn(),
  // 서명 검증이 돌려줄 알림 — 테스트마다 갈아 끼운다.
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

import { POST } from '@/app/api/webhooks/resend/route';

const STATUS_EVENT = {
  type: 'email.delivered',
  created_at: '2026-07-22T01:00:00Z',
  data: { email_id: 'message-1' },
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
});

describe('Resend webhook route — 클릭 알림(email.clicked)', () => {
  beforeEach(() => {
    process.env['RESEND_WEBHOOK_SECRET'] = 'test-secret';
    processMock.mockReset();
    captureMock.mockReset();
  });

  it('클릭 정보를 읽어 수신자 기록 경로로 넘긴다', async () => {
    verified.payload = {
      type: 'email.clicked',
      created_at: '2026-11-20T05:03:11Z',
      data: {
        email_id: 'message-1',
        tags: { campaign_id: 'c1', recipient_id: 'r1' },
        click: {
          ipAddress: '203.0.113.7',
          link: 'https://spri.kr/posts',
          timestamp: '2026-11-20T05:03:10.000Z',
          userAgent: 'Mozilla/5.0',
        },
      },
    };
    processMock.mockResolvedValueOnce('processed');

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(processMock).toHaveBeenCalledWith({
      id: 'svix-event-1',
      type: 'email.clicked',
      createdAt: '2026-11-20T05:03:11Z',
      resendMessageId: 'message-1',
      tags: { campaign_id: 'c1', recipient_id: 'r1' },
      click: {
        link: 'https://spri.kr/posts',
        timestamp: '2026-11-20T05:03:10.000Z',
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      },
    });
  });

  it('클릭 정보의 모양이 다르면 null 로 넘긴다 — 서비스가 열람으로만 올린다', async () => {
    verified.payload = {
      type: 'email.clicked',
      created_at: '2026-11-20T05:03:11Z',
      data: { email_id: 'message-1' },
    };
    processMock.mockResolvedValueOnce('processed');

    await POST(webhookRequest());

    expect(processMock).toHaveBeenCalledWith(expect.objectContaining({ click: null }));
  });

  it('상태 알림에는 클릭 정보를 붙이지 않는다', async () => {
    verified.payload = STATUS_EVENT;
    processMock.mockResolvedValueOnce('processed');

    await POST(webhookRequest());

    expect(processMock.mock.calls[0]?.[0]).not.toHaveProperty('click');
  });
});
