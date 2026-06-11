import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * 회귀: 전건 failed(message_id 없음)로 끝난 캠페인은 webhook이 도착하지 않아
 * 'sending'에 영영 갇혔다(M31). dispatchCampaignChunk가 청크 처리 후 finalize를
 * 직접 호출해 'partial'/'completed'로 종결시키는지 검증한다.
 */

const { sendBatchMock } = vi.hoisted(() => ({
  sendBatchMock: vi.fn(),
}));

// 청크 처리에 필요한 환경변수.
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

const recipientRows = [
  {
    recipientId: 'r1',
    emailSnapshot: 'a@example.com',
    inviteToken: 'inv1',
    unsubscribeToken: 'unsub1',
    attrs: {},
  },
];

// execute로 흘러간 finalize SQL 문자열을 수집한다.
const executedSql: string[] = [];

function sqlToText(query: unknown): string {
  if (typeof query === 'string') return query;
  const q = query as { strings?: string[]; queryChunks?: Array<{ value?: string[] }> };
  if (Array.isArray(q.strings)) return q.strings.join(' ');
  if (Array.isArray(q.queryChunks)) {
    return q.queryChunks
      .map((c) => (Array.isArray(c.value) ? c.value.join('') : ''))
      .join(' ');
  }
  return JSON.stringify(query);
}

vi.mock('@/db', () => {
  // db.select()는 두 번 사용된다: 1) campaign 단건, 2) recipients join.
  // 호출 순서로 분기한다.
  let selectCall = 0;
  const db = {
    select: vi.fn(() => {
      const idx = selectCall++;
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
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: 'r1' }]),
            })),
          })),
        })),
        execute: vi.fn(async (query: unknown) => {
          executedSql.push(sqlToText(query));
        }),
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
  executedSql.length = 0;
  sendBatchMock.mockReset();
});

describe('dispatchCampaignChunk finalize', () => {
  it('전건 failed(message_id 없음)여도 청크 후 finalize SQL을 실행한다', async () => {
    sendBatchMock.mockResolvedValue([
      { recipientId: 'r1', resendMessageId: null, errorReason: 'rate limit' },
    ]);

    const res = await dispatchCampaignChunk('c1', ['r1']);

    expect(res).toEqual({ sent: 0, failed: 1 });
    // finalize SQL(status='sending' AND queued_count=0 AND sent_count=0)이 실행돼야 한다.
    const ran = executedSql.some(
      (s) => s.includes("status = 'sending'") && s.includes('queued_count = 0') && s.includes('sent_count = 0'),
    );
    expect(ran).toBe(true);
  });
});
