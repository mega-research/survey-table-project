import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * 보안/컴플라이언스: 캠페인 큐잉 시점에는 수신거부 필터(isNull(unsubscribedAt))가
 * 적용되지만, 큐잉 → 실제 dispatch 사이에 수신거부한 사람은 차단되지 않는 TOCTOU 가
 * 있었다(정보통신망법 제50조 수신거부 즉시반영 위반 소지). dispatchCampaignChunk 가
 * campaign → contact → recipient 잠금 아래 unsubscribedAt 를 재검증해 제외하고
 * skipped_unsubscribed 로 마감하는지 검증.
 */

const { sendRecipientMock, selectState } = vi.hoisted(() => ({
  sendRecipientMock: vi.fn(),
  selectState: { call: 0 },
}));

process.env['NEXT_PUBLIC_APP_URL'] = 'https://example.com';
process.env['RESEND_FROM_DOMAIN'] = 'mail.example.com';

const campaign = {
  id: 'c1',
  surveyId: 's1',
  status: 'sending',
  archivedAt: null,
  isTest: false,
  subjectSnapshot: 'subject',
  bodyHtmlSnapshot: '<p>body</p>',
  fromLocalSnapshot: 'noreply',
  fromNameSnapshot: 'Survey',
  replyToSnapshot: null,
  attachmentsSnapshot: [] as unknown[],
  startedAt: new Date(),
};

// r1: 활성 수신자. r2: 큐잉 후 수신거부(unsubscribedAt set) → 발송 제외 대상.
const recipientRows: Array<{
  recipientId: string;
  emailSnapshot: string | null;
  inviteCode: string;
  unsubscribeToken: string;
  attrs: Record<string, string>;
  unsubscribedAt: Date | null;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped_unsubscribed';
  archivedAt: Date | null;
  resendMessageId: string | null;
  sendAttemptedAt: Date | null;
  sendLeaseToken: string | null;
  sendLeaseExpiresAt: Date | null;
  sendPayloadSnapshot: null;
  contactTargetId: string | null;
}> = [
  {
    recipientId: 'r1',
    emailSnapshot: 'active@example.com',
    inviteCode: 'inv1',
    unsubscribeToken: 'unsub1',
    attrs: {},
    unsubscribedAt: null,
    status: 'queued',
    archivedAt: null,
    resendMessageId: null,
    sendAttemptedAt: null,
    sendLeaseToken: null,
    sendLeaseExpiresAt: null,
    sendPayloadSnapshot: null,
    contactTargetId: 'contact-r1',
  },
  {
    recipientId: 'r2',
    emailSnapshot: 'gone@example.com',
    inviteCode: 'inv2',
    unsubscribeToken: 'unsub2',
    attrs: {},
    unsubscribedAt: new Date('2026-01-01T00:00:00Z'),
    status: 'queued',
    archivedAt: null,
    resendMessageId: null,
    sendAttemptedAt: null,
    sendLeaseToken: null,
    sendLeaseExpiresAt: null,
    sendPayloadSnapshot: null,
    contactTargetId: 'contact-r2',
  },
];

const setPayloads: Array<Record<string, unknown>> = [];
let claimIndex = 0;

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
        leftJoin() {
          return this;
        },
        where() {
          return idx === 0 ? Promise.resolve([campaign]) : Promise.resolve(recipientRows);
        },
      };
    }),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<void> | void) => {
      let claimedRecipient: (typeof recipientRows)[number] | null = null;
      const tx = {
        select: vi.fn((selection?: Record<string, unknown>) => {
          const keys = Object.keys(selection ?? {});
          let result: unknown[];
          if (keys.includes('contactTargetId') && keys.length === 2) {
            claimedRecipient = recipientRows[claimIndex++] ?? null;
            result = claimedRecipient
              ? [{ id: claimedRecipient.recipientId, contactTargetId: claimedRecipient.contactTargetId }]
              : [];
          } else if (keys.includes('unsubscribedAt')) {
            result = claimedRecipient?.contactTargetId
              ? [{
                  id: claimedRecipient.contactTargetId,
                  unsubscribedAt: claimedRecipient.unsubscribedAt,
                }]
              : [];
          } else if (keys.includes('sendPayloadSnapshot')) {
            result = claimedRecipient
              ? [{ id: claimedRecipient.recipientId, ...claimedRecipient }]
              : [];
          } else {
            result = [campaign];
          }
          const builder = {
            from() {
              return this;
            },
            where() {
              return this;
            },
            for: vi.fn(async () => result),
            then(
              resolve: (value: unknown[]) => unknown,
              reject?: (reason: unknown) => unknown,
            ) {
              return Promise.resolve(result).then(resolve, reject);
            },
          };
          return builder;
        }),
        update: vi.fn(() => ({
          set: vi.fn((payload: Record<string, unknown>) => {
            setPayloads.push(payload);
            return {
              where: vi.fn(() => ({
                returning: vi.fn(async () => {
                  if (payload['status'] === 'skipped_unsubscribed') {
                    Object.assign(claimedRecipient ?? recipientRows[1]!, payload);
                    return [{
                      id: claimedRecipient?.recipientId ?? 'r2',
                      archivedAt: claimedRecipient?.archivedAt ?? null,
                    }];
                  }
                  if (payload['status'] === 'sending' || payload['status'] === 'sent') {
                    Object.assign(claimedRecipient ?? recipientRows[0]!, payload);
                    return [{
                      id: claimedRecipient?.recipientId ?? 'r1',
                      archivedAt: claimedRecipient?.archivedAt ?? null,
                    }];
                  }
                  if (payload['status'] === 'failed') {
                    Object.assign(claimedRecipient ?? recipientRows[0]!, payload);
                    return [{
                      id: claimedRecipient?.recipientId ?? 'r1',
                      archivedAt: claimedRecipient?.archivedAt ?? null,
                    }];
                  }
                  return [{ id: 'x' }];
                }),
              })),
            };
          }),
        })),
        execute: vi.fn(async () => {}),
      };
      return cb(tx);
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
  sendCampaignRecipient: sendRecipientMock,
}));

vi.mock('@/lib/mail/template-wrapper', () => ({
  MailWrapper: () => null,
}));

import { dispatchCampaignChunk } from '@/lib/mail/campaign-dispatch';

beforeEach(() => {
  setPayloads.length = 0;
  selectState.call = 0;
  claimIndex = 0;
  recipientRows[0]!.emailSnapshot = 'active@example.com';
  recipientRows[0]!.status = 'queued';
  recipientRows[0]!.sendAttemptedAt = null;
  recipientRows[0]!.sendLeaseToken = null;
  recipientRows[0]!.sendLeaseExpiresAt = null;
  recipientRows[0]!.resendMessageId = null;
  recipientRows[1]!.status = 'queued';
  recipientRows[1]!.resendMessageId = null;
  sendRecipientMock.mockReset();
  sendRecipientMock.mockImplementation(async (input: { recipient: { recipientId: string } }) => ({
    kind: 'accepted',
    resendMessageId: `msg-${input.recipient.recipientId}`,
  }));
});

describe('dispatchCampaignChunk 수신거부 재검증', () => {
  it('큐잉 후 수신거부한 수신자는 발송 대상에서 제외한다', async () => {
    await dispatchCampaignChunk('c1', ['r1', 'r2']);

    expect(sendRecipientMock).toHaveBeenCalledTimes(1);
    const sentInput = sendRecipientMock.mock.calls[0]![0] as {
      recipient: { to: string };
    };
    expect(sentInput.recipient.to).toBe('active@example.com');
  });

  it('제외된 수신자를 skipped_unsubscribed 로 마감한다', async () => {
    await dispatchCampaignChunk('c1', ['r1', 'r2']);

    const skipped = setPayloads.some((p) => p['status'] === 'skipped_unsubscribed');
    expect(skipped).toBe(true);
  });

  it('이메일 스냅샷이 없으면 외부 발송 입력에서 제외한다', async () => {
    recipientRows[0]!.emailSnapshot = null;

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 0,
      failed: 1,
    });
    expect(sendRecipientMock).not.toHaveBeenCalled();
  });
});
