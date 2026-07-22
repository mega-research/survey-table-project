import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}));

vi.mock('@/lib/mail/resend-client', () => ({
  getResend: () => ({ emails: { send: sendMock } }),
}));

import {
  RetryableCampaignSendError,
  sendCampaignRecipient,
} from '@/lib/mail/send-bulk';

const input = {
  from: 'Survey <survey@mail.example.com>',
  replyTo: 'reply@example.com',
  campaignId: 'campaign-1',
  idempotencyKey: 'campaign/campaign-1/recipient/recipient-1',
  recipient: {
    recipientId: 'recipient-1',
    to: 'target@example.com',
    subject: '설문 참여',
    html: '<p>본문</p>',
  },
};

beforeEach(() => {
  sendMock.mockReset();
});

describe('sendCampaignRecipient', () => {
  it('recipient별 stable idempotency key와 payload로 발송한다', async () => {
    sendMock.mockResolvedValue({ data: { id: 'message-1' }, error: null });

    await expect(sendCampaignRecipient(input)).resolves.toEqual({
      kind: 'accepted',
      resendMessageId: 'message-1',
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['target@example.com'],
        headers: { 'X-Entity-Ref-ID': input.idempotencyKey },
        tags: expect.arrayContaining([
          { name: 'campaign_id', value: 'campaign-1' },
          { name: 'recipient_id', value: 'recipient-1' },
        ]),
      }),
      { idempotencyKey: input.idempotencyKey },
    );
  });

  it('재시도로 해결되지 않는 Resend 오류는 permanent failure로 반환한다', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'validation_error',
        message: 'invalid email',
        statusCode: 422,
      },
    });

    await expect(sendCampaignRecipient(input)).resolves.toEqual({
      kind: 'permanent_failure',
      errorReason: 'invalid email',
    });
  });

  it.each([
    { name: 'rate_limit_exceeded', statusCode: 429 },
    { name: 'monthly_quota_exceeded', statusCode: 429 },
    { name: 'concurrent_idempotent_requests', statusCode: 409 },
    { name: 'unknown_error', statusCode: null },
  ])('$name 오류는 retryable 예외로 전파한다', async ({ name, statusCode }) => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name, message: 'retry later', statusCode },
    });

    await expect(sendCampaignRecipient(input)).rejects.toBeInstanceOf(
      RetryableCampaignSendError,
    );
  });
});
