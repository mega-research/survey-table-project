import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { processMock, captureMock } = vi.hoisted(() => ({
  processMock: vi.fn(),
  captureMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({
  captureException: captureMock,
  captureMessage: vi.fn(),
}));
vi.mock('svix', () => ({
  Webhook: class {
    verify() {
      return {
        type: 'email.delivered',
        created_at: '2026-07-22T01:00:00Z',
        data: { email_id: 'message-1' },
      };
    }
  },
}));
vi.mock('@/lib/mail/resend-webhook', () => ({
  processResendWebhookEvent: processMock,
}));

import { POST } from '@/app/api/webhooks/resend/route';

describe('Resend webhook route retry response', () => {
  beforeEach(() => {
    process.env['RESEND_WEBHOOK_SECRET'] = 'test-secret';
    processMock.mockReset();
    captureMock.mockReset();
  });

  it('transaction 처리 실패를 non-2xx로 반환해 provider retry를 요청한다', async () => {
    processMock.mockRejectedValueOnce(new Error('transient db failure'));
    const request = new NextRequest('http://localhost/api/webhooks/resend', {
      method: 'POST',
      body: '{}',
      headers: {
        'svix-id': 'svix-event-1',
        'svix-timestamp': '1',
        'svix-signature': 'signature',
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
    expect(captureMock).toHaveBeenCalledOnce();
  });
});
