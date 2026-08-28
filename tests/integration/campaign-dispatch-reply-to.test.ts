import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 티켓 20 — 메일 회신 소유자 연동.
 *
 * 회신 주소만 스냅샷 밖에 있다: 발송 시점의 **현재 소유자**로 해석된다. 그래서 소유권을
 * 이전하면(티켓 19) 그 다음 발송분부터 새 소유자에게 답장이 가고, 발신 주소·제목·본문·
 * 과거 발송 기록은 그대로다. 명시 회신 주소가 스냅샷에 박힌 캠페인은 소유자 조회조차 하지
 * 않는다 — 고정 회신에 불필요한 DB 왕복과 장애 지점을 만들지 않기 위한 지연 평가다.
 */

const { sendRecipientMock, ownerEmailMock, selectState } = vi.hoisted(() => ({
  sendRecipientMock: vi.fn(),
  ownerEmailMock: vi.fn(),
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
  replyToSnapshot: null as string | null,
  attachmentsSnapshot: [] as unknown[],
  startedAt: new Date(),
};

const recipient = {
  recipientId: 'r1',
  emailSnapshot: 'active@example.com',
  contactTargetId: 'contact-r1',
  inviteCode: 'inv1',
  unsubscribeToken: 'unsub1',
  attrs: {} as Record<string, string>,
  unsubscribedAt: null as Date | null,
  status: 'queued' as string,
  archivedAt: null as Date | null,
  resendMessageId: null as string | null,
  sendAttemptedAt: null as Date | null,
  sendLeaseToken: null as string | null,
  sendLeaseExpiresAt: null as Date | null,
  sendPayloadSnapshot: null as unknown,
};

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
          return idx === 0 ? Promise.resolve([campaign]) : Promise.resolve([recipient]);
        },
      };
    }),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<void> | void) => {
      const tx = {
        select: vi.fn((selection?: Record<string, unknown>) => {
          const keys = Object.keys(selection ?? {});
          let result: unknown[];
          if (keys.includes('contactTargetId') && keys.length === 2) {
            result = [{ id: recipient.recipientId, contactTargetId: recipient.contactTargetId }];
          } else if (keys.includes('attemptId')) {
            result = [];
          } else if (keys.includes('unsubscribedAt')) {
            result = [{ id: recipient.contactTargetId, unsubscribedAt: null }];
          } else if (keys.includes('sendPayloadSnapshot')) {
            result = [{ id: recipient.recipientId, ...recipient }];
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
            limit() {
              return this;
            },
            for: vi.fn(async () => result),
            then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
              return Promise.resolve(result).then(resolve, reject);
            },
          };
          return builder;
        }),
        update: vi.fn(() => ({
          set: vi.fn((payload: Record<string, unknown>) => {
            Object.assign(recipient, payload);
            return {
              where: vi.fn(() => ({
                returning: vi.fn(async () => [
                  { id: recipient.recipientId, archivedAt: recipient.archivedAt },
                ]),
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

vi.mock('@/server/read-models/survey-owner-email', () => ({
  getSurveyOwnerEmail: ownerEmailMock,
}));

vi.mock('@react-email/render', () => ({
  render: vi.fn(async () => '<html></html>'),
}));

vi.mock('@/server/mail/services/render-for-send', () => ({
  renderForCampaignSend: () => ({ subject: 'subject', bodyHtml: '<p>body</p>' }),
}));

vi.mock('@/server/mail/services/send-bulk', () => ({
  resolveCampaignAttachments: vi.fn(async () => undefined),
  sendCampaignRecipient: sendRecipientMock,
}));

vi.mock('@/server/mail/services/template-wrapper', () => ({
  MailWrapper: () => null,
}));

vi.mock('@/server/read-models/result-code-statuses', () => ({
  getResultCodeStatuses: vi.fn(async () => ({ positive: [], negative: [] })),
}));

import { dispatchCampaignChunk } from '@/server/mail/services/campaign-dispatch';

beforeEach(() => {
  selectState.call = 0;
  campaign.replyToSnapshot = null;
  Object.assign(recipient, {
    status: 'queued',
    resendMessageId: null,
    sendAttemptedAt: null,
    sendLeaseToken: null,
    sendLeaseExpiresAt: null,
    sendPayloadSnapshot: null,
  });
  sendRecipientMock.mockReset();
  sendRecipientMock.mockImplementation(async (input: { recipient: { recipientId: string } }) => ({
    kind: 'accepted',
    resendMessageId: `msg-${input.recipient.recipientId}`,
  }));
  ownerEmailMock.mockReset();
});

/** 한 청크를 발송하고 외부 발송기에 넘어간 인자를 돌려준다. */
async function dispatchAndCapture(): Promise<{ from: string; replyTo: string }> {
  selectState.call = 0;
  await dispatchCampaignChunk('c1', ['r1']);
  const call = sendRecipientMock.mock.calls.at(-1)?.[0] as
    | { from: string; replyTo: string }
    | undefined;
  if (!call) throw new Error('sendCampaignRecipient 가 호출되지 않았습니다');
  return call;
}

describe('dispatchCampaignChunk 회신 주소 소유자 연동', () => {
  it('스냅샷이 비어 있으면 발송 시점 소유자 이메일로 회신을 해석한다', async () => {
    ownerEmailMock.mockResolvedValue('owner@example.com');

    const { replyTo } = await dispatchAndCapture();

    expect(ownerEmailMock).toHaveBeenCalledWith('s1');
    expect(replyTo).toBe('owner@example.com');
  });

  it('소유권 이전 뒤 발송분부터 새 소유자에게 회신이 간다', async () => {
    ownerEmailMock.mockResolvedValue('before@example.com');
    const before = await dispatchAndCapture();

    // 이전 발생 — 캠페인 스냅샷은 그대로고 소유자만 바뀐다. 수신자는 아직 발송 payload 를
    // 굳히지 않은 새 회차의 것이다(이미 claim 된 수신자는 그 payload 를 그대로 쓴다).
    Object.assign(recipient, {
      status: 'queued',
      resendMessageId: null,
      sendAttemptedAt: null,
      sendLeaseToken: null,
      sendLeaseExpiresAt: null,
      sendPayloadSnapshot: null,
    });
    ownerEmailMock.mockResolvedValue('after@example.com');
    const after = await dispatchAndCapture();

    expect(before.replyTo).toBe('before@example.com');
    expect(after.replyTo).toBe('after@example.com');
  });

  it('스냅샷에 회신 주소가 박혀 있으면 소유자를 조회하지 않는다', async () => {
    campaign.replyToSnapshot = 'fixed@example.com';
    ownerEmailMock.mockResolvedValue('owner@example.com');

    const { replyTo } = await dispatchAndCapture();

    expect(replyTo).toBe('fixed@example.com');
    expect(ownerEmailMock).not.toHaveBeenCalled();
  });

  it('소유자가 없는 설문은 발신 주소로 폴백한다', async () => {
    ownerEmailMock.mockResolvedValue(null);

    const { replyTo } = await dispatchAndCapture();

    expect(replyTo).toBe('noreply@mail.example.com');
  });

  it('발신 주소는 소유자와 무관하게 스냅샷 그대로다', async () => {
    ownerEmailMock.mockResolvedValue('owner@example.com');

    const { from } = await dispatchAndCapture();

    expect(from).toBe('Survey <noreply@mail.example.com>');
  });
});
