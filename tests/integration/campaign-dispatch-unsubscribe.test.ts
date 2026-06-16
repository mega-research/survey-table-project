import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * 보안/컴플라이언스: 캠페인 큐잉 시점에는 수신거부 필터(isNull(unsubscribedAt))가
 * 적용되지만, 큐잉 → 실제 dispatch 사이에 수신거부한 사람은 차단되지 않는 TOCTOU 가
 * 있었다(정보통신망법 제50조 수신거부 즉시반영 위반 소지). dispatchCampaignChunk 가
 * 발송 직전 unsubscribedAt 를 재검증해 제외하고 skipped_unsubscribed 로 마감하는지 검증.
 */

const { sendBatchMock, selectState } = vi.hoisted(() => ({
  sendBatchMock: vi.fn(),
  selectState: { call: 0 },
}));

process.env['NEXT_PUBLIC_APP_URL'] = 'https://example.com';
process.env['RESEND_FROM_DOMAIN'] = 'mail.example.com';

const campaign = {
  id: 'c1',
  surveyId: 's1',
  status: 'sending',
  subjectSnapshot: 'subject',
  bodyHtmlSnapshot: '<p>body</p>',
  fromLocalSnapshot: 'noreply',
  fromNameSnapshot: 'Survey',
  replyToSnapshot: null,
  attachmentsSnapshot: [] as unknown[],
  startedAt: new Date(),
};

// r1: 활성 수신자. r2: 큐잉 후 수신거부(unsubscribedAt set) → 발송 제외 대상.
const recipientRows = [
  {
    recipientId: 'r1',
    emailSnapshot: 'active@example.com',
    inviteToken: 'inv1',
    unsubscribeToken: 'unsub1',
    attrs: {},
    unsubscribedAt: null,
  },
  {
    recipientId: 'r2',
    emailSnapshot: 'gone@example.com',
    inviteToken: 'inv2',
    unsubscribeToken: 'unsub2',
    attrs: {},
    unsubscribedAt: new Date('2026-01-01T00:00:00Z'),
  },
];

const setPayloads: Array<Record<string, unknown>> = [];

vi.mock('@/db', () => {
  const db = {
    select: vi.fn(() => {
      const idx = selectState.call++;
      return {
        from() {
          return this;
        },
        innerJoin() {
          return this;
        },
        where() {
          return idx === 0 ? Promise.resolve([campaign]) : Promise.resolve(recipientRows);
        },
      };
    }),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<void> | void) => {
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn((payload: Record<string, unknown>) => {
            setPayloads.push(payload);
            return {
              where: vi.fn(() => ({
                returning: vi.fn(async () => [{ id: 'x' }]),
              })),
            };
          }),
        })),
        execute: vi.fn(async () => {}),
      };
      await cb(tx);
    }),
  };
  return { db };
});

vi.mock('@react-email/render', () => ({
  render: vi.fn(async () => '<html></html>'),
}));

vi.mock('@/lib/mail/render-for-send', () => ({
  renderForCampaignSend: () => ({ subject: 'subject', bodyHtml: '<p>body</p>' }),
}));

vi.mock('@/lib/mail/send-bulk', () => ({
  resolveCampaignAttachments: vi.fn(async () => undefined),
  sendCampaignBatch: sendBatchMock,
}));

vi.mock('@/lib/mail/template-wrapper', () => ({
  MailWrapper: () => null,
}));

import { dispatchCampaignChunk } from '@/lib/mail/campaign-dispatch';

beforeEach(() => {
  setPayloads.length = 0;
  selectState.call = 0;
  sendBatchMock.mockReset();
  sendBatchMock.mockImplementation(
    async (input: { recipients: Array<{ recipientId: string; to: string }> }) =>
      input.recipients.map((r) => ({ recipientId: r.recipientId, resendMessageId: `msg-${r.recipientId}` })),
  );
});

describe('dispatchCampaignChunk 수신거부 재검증', () => {
  it('큐잉 후 수신거부한 수신자는 발송 대상에서 제외한다', async () => {
    await dispatchCampaignChunk('c1', ['r1', 'r2']);

    expect(sendBatchMock).toHaveBeenCalledTimes(1);
    const sentInput = sendBatchMock.mock.calls[0]![0] as {
      recipients: Array<{ to: string }>;
    };
    const sentTos = sentInput.recipients.map((r) => r.to);
    expect(sentTos).toContain('active@example.com');
    expect(sentTos).not.toContain('gone@example.com');
  });

  it('제외된 수신자를 skipped_unsubscribed 로 마감한다', async () => {
    await dispatchCampaignChunk('c1', ['r1', 'r2']);

    const skipped = setPayloads.some((p) => p['status'] === 'skipped_unsubscribed');
    expect(skipped).toBe(true);
  });
});
