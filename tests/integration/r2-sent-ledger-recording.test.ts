/**
 * 발신 시점 발송 장부 기록 — integration (이슈 04).
 *
 * 계약:
 * - 캠페인 dispatch prepare 시 캠페인 스냅샷(bodyHtmlSnapshot·attachmentsSnapshot)
 *   유래 R2 키로 recordSentKeys 가 호출된다 (data-link-bands 밴드 URL 포함,
 *   tmp/외부 도메인 제외)
 * - 장부 기록 실패는 dispatch 를 중단시킨다 (기록 없는 발송 금지)
 * - 단건 테스트 발송도 발송 전에 최종 본문(밴드 슬라이스 반영분)+첨부의 키로
 *   기록된다
 * - extractMailContentKeys 결과에 tmp/* 키가 없다 (게이트 고정)
 *
 * prior art: campaign-dispatch-safety.test.ts 의 @/db 체인 mock + vi.hoisted.
 * 장부 서비스는 모듈 mock — 실DB 왕복은 r2-sent-ledger-seed.realdb.test.ts 담당.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KNOWN_HOST = 'https://cdn-dev.megaresearch.co.kr';

const { state, recordSentKeysMock, sendTestMailMock, ensureSlicesMock } = vi.hoisted(() => ({
  state: {
    campaign: {
      id: 'c1',
      surveyId: 's1',
      status: 'queued' as string,
      archivedAt: null as Date | null,
      startedAt: null as Date | null,
      isTest: false,
      subjectSnapshot: 'subject',
      bodyHtmlSnapshot: '',
      fromLocalSnapshot: 'noreply',
      fromNameSnapshot: 'Survey',
      replyToSnapshot: null as string | null,
      attachmentsSnapshot: [] as unknown[],
    },
  },
  recordSentKeysMock: vi.fn<(dbc: unknown, keys: readonly string[]) => Promise<number>>(
    async () => 0,
  ),
  sendTestMailMock: vi.fn(async () => ({ ok: true, id: 'msg-1' })),
  ensureSlicesMock: vi.fn(async (html: string) => html),
}));

process.env['RESEND_FROM_DOMAIN'] = 'mail.example.com';
process.env['NEXT_PUBLIC_APP_URL'] = 'https://example.com';

function makeSelect() {
  let tableName = '';
  const rowsFor = (): unknown[] => {
    if (tableName === 'mail_campaigns') return [{ ...state.campaign }];
    if (tableName === 'mail_recipients') return [{ id: 'r1' }];
    return [];
  };
  const chain = {
    from(table: object) {
      tableName = Reflect.get(table, Symbol.for('drizzle:Name')) as string;
      return chain;
    },
    where() {
      return chain;
    },
    for: async () => rowsFor(),
    then<T>(resolve: (rows: unknown[]) => T) {
      return Promise.resolve(rowsFor()).then(resolve);
    },
  };
  return chain;
}

function makeUpdate() {
  const terminal = {
    returning: async () => [{ id: state.campaign.id }],
    then<T>(resolve: (rows: unknown[]) => T) {
      return Promise.resolve([{ id: state.campaign.id }]).then(resolve);
    },
  };
  return {
    set() {
      return {
        where() {
          return terminal;
        },
      };
    },
  };
}

const txMock = {
  select: () => makeSelect(),
  update: () => makeUpdate(),
};

vi.mock('@/db', () => ({
  db: {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(txMock),
  },
}));

vi.mock('@/server/shared/r2-lifecycle/sent-ledger.server', () => ({
  recordSentKeys: recordSentKeysMock,
}));

vi.mock('@react-email/render', () => ({
  render: vi.fn(async () => '<html></html>'),
}));

vi.mock('@/server/mail/services/render-for-send', () => ({
  renderForCampaignSend: (input: { subject: string; bodyHtml: string }) => input,
  renderForTestSend: (input: { subject: string; bodyHtml: string; fromName: string }) => ({
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    fromName: input.fromName,
  }),
}));

vi.mock('@/server/mail/services/campaign-send-rate-limit', () => ({
  createCampaignProviderRateLimiter: () => ({ waitForTurn: vi.fn() }),
}));

vi.mock('@/server/mail/services/send-bulk', () => ({
  resolveCampaignAttachments: vi.fn(),
  sendCampaignRecipient: vi.fn(),
  RetryableCampaignSendError: class RetryableCampaignSendError extends Error {},
}));

vi.mock('@/server/mail/services/template-wrapper', () => ({
  MailWrapper: () => null,
}));

vi.mock('@/server/mail/services/image-link-band-slices', () => ({
  ensureImageLinkBandSlices: ensureSlicesMock,
}));

vi.mock('@/server/mail/services/send', () => ({
  sendTestMail: sendTestMailMock,
}));

vi.mock('@/server/shared/contact-sample.server', () => ({
  getContactSampleById: vi.fn(async () => null),
  getFirstContactSample: vi.fn(async () => null),
}));

vi.mock('@/server/shared/data-scope.server', () => ({
  loadOperationsDataScope: vi.fn(async () => ({ mode: 'all' })),
}));

import { db } from '@/db';
import { prepareCampaignDispatch } from '@/server/mail/services/campaign-dispatch';
import { extractMailContentKeys } from '@/server/shared/r2-lifecycle/key-extract';
import { sendTestTemplateMail } from '@/server/mail/services/mail-preview.service';

function recordedKeys(callIndex = 0): string[] {
  const call = recordSentKeysMock.mock.calls[callIndex];
  if (!call) throw new Error('recordSentKeys 호출이 없다');
  return [...call[1]];
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureSlicesMock.mockImplementation(async (html: string) => html);
  sendTestMailMock.mockResolvedValue({ ok: true, id: 'msg-1' });
  state.campaign.status = 'queued';
  state.campaign.archivedAt = null;
  state.campaign.bodyHtmlSnapshot = '';
  state.campaign.attachmentsSnapshot = [];
});

describe('캠페인 dispatch 발신 시점 장부 기록', () => {
  it('prepare 시 스냅샷 유래 키(밴드 포함, tmp/외부 제외)로 recordSentKeys 를 같은 tx 로 호출한다', async () => {
    state.campaign.bodyHtmlSnapshot = [
      `<p><img src="${KNOWN_HOST}/mail/s1/hero.png"></p>`,
      `<img src="${KNOWN_HOST}/mail/s1/banner.png"`,
      ` data-link-bands="${KNOWN_HOST}/mail/s1/band-1.png|${KNOWN_HOST}/mail/s1/band-2.png">`,
      `<img src="${KNOWN_HOST}/tmp/mail/s1/draft.png">`,
      '<img src="https://external.example.com/mail/evil.png">',
    ].join('');
    state.campaign.attachmentsSnapshot = [
      { key: 'mail-attachment/s1/doc.pdf', filename: 'doc.pdf', size: 100, mime: 'application/pdf' },
    ];

    const result = await prepareCampaignDispatch('c1');

    expect(result).toEqual({ recipientIds: ['r1'] });
    expect(recordSentKeysMock).toHaveBeenCalledTimes(1);
    // 같은 트랜잭션의 executor(tx)로 기록한다
    expect(recordSentKeysMock.mock.calls[0]?.[0]).toBe(txMock);
    expect(recordedKeys().sort()).toEqual(
      [
        'mail-attachment/s1/doc.pdf',
        'mail/s1/band-1.png',
        'mail/s1/band-2.png',
        'mail/s1/banner.png',
        'mail/s1/hero.png',
      ].sort(),
    );
  });

  it('장부 기록 실패는 dispatch 준비를 중단시킨다 (기록 없는 발송 금지)', async () => {
    state.campaign.bodyHtmlSnapshot = `<img src="${KNOWN_HOST}/mail/s1/hero.png">`;
    recordSentKeysMock.mockRejectedValueOnce(new Error('장부 기록 실패'));

    await expect(prepareCampaignDispatch('c1')).rejects.toThrow('장부 기록 실패');
  });
});

describe('단건 테스트 발송 발신 시점 장부 기록', () => {
  const baseInput = {
    surveyId: '00000000-0000-0000-0000-000000000001',
    to: 'tester@example.com',
    subject: '테스트 제목',
    bodyHtml: '',
    fromName: '발신자',
    fromLocal: 'noreply',
    replyTo: 'reply@example.com',
    attachments: [] as Array<{ key: string; filename: string; size: number; mime: string }>,
  };

  it('밴드 슬라이스 반영 후 본문+첨부의 키를 발송 전에 기록한다', async () => {
    // 밴드 슬라이스가 발송 시점에 생성되는 상황 재현 — 기록은 슬라이스 반영
    // 결과(html)에서 추출돼야 밴드 키가 보호된다.
    ensureSlicesMock.mockImplementation(async (html: string) =>
      `${html}<img src="${KNOWN_HOST}/mail/s1/full.png"`
      + ` data-link-bands="${KNOWN_HOST}/mail/s1/band-a.png|${KNOWN_HOST}/mail/s1/band-b.png">`);

    const result = await sendTestTemplateMail({
      ...baseInput,
      bodyHtml: `<img src="${KNOWN_HOST}/mail/s1/body.png"><img src="${KNOWN_HOST}/tmp/mail/s1/draft.png">`,
      attachments: [
        { key: 'mail-attachment/s1/report.pdf', filename: 'report.pdf', size: 10, mime: 'application/pdf' },
      ],
    });

    expect(result.ok).toBe(true);
    expect(recordSentKeysMock).toHaveBeenCalledTimes(1);
    expect(recordSentKeysMock.mock.calls[0]?.[0]).toBe(db);
    expect(recordedKeys().sort()).toEqual(
      [
        'mail-attachment/s1/report.pdf',
        'mail/s1/band-a.png',
        'mail/s1/band-b.png',
        'mail/s1/body.png',
        'mail/s1/full.png',
      ].sort(),
    );
    // 기록이 발송보다 먼저다 — 기록 실패 시 발송이 나가면 안 되는 순서 계약
    const recordOrder = recordSentKeysMock.mock.invocationCallOrder[0];
    const sendOrder = sendTestMailMock.mock.invocationCallOrder[0];
    expect(recordOrder).toBeDefined();
    expect(sendOrder).toBeDefined();
    expect(recordOrder ?? 0).toBeLessThan(sendOrder ?? 0);
  });
});

describe('extractMailContentKeys 게이트 고정', () => {
  it('tmp/* 키는 본문·첨부 어느 쪽에서도 추출 결과에 나타나지 않는다', () => {
    const keys = extractMailContentKeys({
      bodyHtml:
        `<img src="${KNOWN_HOST}/tmp/mail/s1/draft.png">`
        + `<img src="${KNOWN_HOST}/mail/s1/kept.png">`,
      attachments: [
        { key: 'tmp/mail-attachment/s1/draft.pdf', filename: 'draft.pdf', size: 1, mime: 'application/pdf' },
      ],
    });
    expect(keys).toEqual(['mail/s1/kept.png']);
  });
});
