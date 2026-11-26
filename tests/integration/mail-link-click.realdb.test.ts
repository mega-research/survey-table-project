import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactPii,
  contactTargets,
  mailCampaigns,
  mailLinkClicks,
  mailRecipients,
  surveys,
} from '@/db/schema';
import { encryptPii } from '@/lib/crypto/aes';
import { blindIndex } from '@/lib/crypto/blind';
import { saltedHash } from '@/lib/duplicate-detection/salted-hash.server';
import { logger } from '@/lib/logger';
import { fetchCandidateIds } from '@/server/mail/services/campaigns';
import {
  countCampaignCandidates,
  listCampaignRecipients,
  listCampaignsForSurvey,
  previewCampaignCandidates,
} from '@/server/mail/services/campaigns-read';
import { MAX_CLICKS_PER_RECIPIENT } from '@/server/mail/domain/link-click';
import { FIELDWORK_SHARE_ALL } from '@/server/fieldwork-share-scope';
import {
  type ContactListFilterParams,
  contactFilterInputFromUrl,
  loadContactFilterContext,
  resolveContactFilter,
} from '@/server/read-models/contact-filter-resolution';
import { listContactsForExport, listContactsForSurvey } from '@/server/read-models/contacts';
import { HEADER_FILTER_VALUE_SEPARATOR } from '@/lib/operations/filter-shared';
import { processResendWebhookEvent } from '@/server/mail/services/resend-webhook';
import type { MailRecipientStatus } from '@/shared/contracts/mail';

import { resolvedFilterForTest } from '../helpers/resolved-contact-filter';

vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(async () => undefined) } }));
// 요청 밖이라 쿠키가 없다 — 콘솔은 실데이터 파티션을 본다(server/data-scope).
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
// 「필터 결과 전체 선택」이 읽기 파티션을 정할 때 요청 세션을 본다 — 요청 밖이라 관리자로 둔다.
vi.mock('@/lib/auth/external-viewer', () => ({ isExternalViewer: () => Promise.resolve(false) }));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

const APP = 'https://survey.example.co.kr';
process.env['NEXT_PUBLIC_APP_URL'] = APP;

const SURVEY_LINK = `${APP}/survey/만족도-조사`;
const REPORT_LINK = 'https://spri.kr/posts?code=stat_sw_ai_reports';
const UNSUBSCRIBE_LINK = `${APP}/unsubscribe/3f0c6c1e-0000-4000-8000-000000000001`;

/**
 * 링크 클릭 (CONTEXT.md 「링크 클릭」, ADR 0042) — 발송 서비스의 클릭 알림을 넣고, 담당자가 보는 화면의
 * 읽기 서비스로 확인한다. 클릭 표를 직접 들여다보는 단언은 화면에 나오지 않는 칸에만 둔다.
 */
run('링크 클릭 (mail link click)', () => {
  const surveyId = randomUUID();
  let resid = 0;
  let runNumber = 0;

  beforeAll(async () => {
    await db.insert(surveys).values({
      id: surveyId,
      title: '링크 클릭 실DB 테스트',
      // 링크 클릭 기능 전에 저장된 스킴 모양 — 「링크 클릭」 열이 없다(읽을 때 보정된다).
      contactColumns: {
        version: 1,
        headerRow: 1,
        columns: [
          { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
          { key: 'email_count', label: '메일', source: 'system.email_count', order: 2 },
          { key: '이메일', label: '이메일', source: 'pii.이메일', piiType: 'email', order: 3 },
        ],
      },
    });
  });

  afterAll(async () => {
    await db.delete(surveys).where(eq(surveys.id, surveyId));
  });

  async function seedContact(): Promise<string> {
    const id = randomUUID();
    resid += 1;
    await db.insert(contactTargets).values({ id, surveyId, resid, inviteCode: `lc-${id}` });
    // 단체 메일 후보가 되려면 발송 주소가 있어야 한다.
    const email = `lc-${resid}@example.com`;
    await db.insert(contactPii).values({
      contactTargetId: id,
      fieldType: 'email',
      columnKey: '이메일',
      cipher: encryptPii(email),
      blindIndex: blindIndex('email', email),
    });
    return id;
  }

  async function seedCampaign(): Promise<string> {
    const id = randomUUID();
    runNumber += 1;
    await db.insert(mailCampaigns).values({
      id,
      surveyId,
      runNumber,
      title: `${runNumber}차 안내`,
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
      status: 'completed',
    });
    return id;
  }

  /** 회차의 수신자 하나 — 집계 열도 그 상태에 맞춰 올린다. */
  async function seedRecipient(
    campaignId: string,
    contactId: string,
    status: MailRecipientStatus = 'delivered',
  ): Promise<{ recipientId: string; messageId: string }> {
    const recipientId = randomUUID();
    const messageId = `msg-${recipientId}`;
    await db.insert(mailRecipients).values({
      id: recipientId,
      campaignId,
      contactTargetId: contactId,
      emailSnapshot: 'someone@example.com',
      status,
      resendMessageId: messageId,
    });
    return { recipientId, messageId };
  }

  async function click(
    messageId: string,
    link: string,
    opts: { id?: string; at?: string; ip?: string; ua?: string; tags?: Record<string, string> } = {},
  ) {
    return processResendWebhookEvent({
      id: opts.id ?? `evt-${randomUUID()}`,
      type: 'email.clicked',
      createdAt: '2026-11-20T05:00:00.000Z',
      resendMessageId: messageId,
      ...(opts.tags ? { tags: opts.tags } : {}),
      click: {
        link,
        timestamp: opts.at ?? '2026-11-20T05:03:10.000Z',
        ipAddress: opts.ip ?? '203.0.113.7',
        userAgent: opts.ua ?? 'Mozilla/5.0 (test)',
      },
    });
  }

  async function campaignRow(campaignId: string) {
    const { rows } = await listCampaignsForSurvey({ surveyId, scope: 'real', pageSize: 100 });
    const row = rows.find((r) => r.id === campaignId);
    if (!row) throw new Error('회차가 목록에 없다');
    return row;
  }

  async function recipientStatus(campaignId: string, recipientId: string) {
    const { rows } = await listCampaignRecipients({
      surveyId,
      campaignId,
      scope: 'real',
      pageSize: 100,
    });
    return rows.find((r) => r.id === recipientId)?.status;
  }

  /** 화면에 나오지 않는 칸(주소 유무·IP 해시·브라우저 정보)만 여기로 본다. */
  async function storedClicks(recipientId: string) {
    return db
      .select({
        linkKind: mailLinkClicks.linkKind,
        linkUrl: mailLinkClicks.linkUrl,
        ipHash: mailLinkClicks.ipHash,
        userAgent: mailLinkClicks.userAgent,
        clickedAt: mailLinkClicks.clickedAt,
      })
      .from(mailLinkClicks)
      .where(eq(mailLinkClicks.recipientId, recipientId));
  }

  describe('발송 회차 목록의 「클릭」', () => {
    it('설문 링크를 누르면 그 회차의 클릭이 1이 되고 수신 상황이 열람으로 오른다', async () => {
      const campaignId = await seedCampaign();
      const { messageId } = await seedRecipient(campaignId, await seedContact());

      expect(await click(messageId, SURVEY_LINK)).toBe('processed');

      const row = await campaignRow(campaignId);
      expect(row.clickedCount).toBe(1);
      expect(row.openedCount).toBe(1);
    });

    it('그 밖의 링크나 수신거부 링크만 누른 회차는 클릭이 0이다', async () => {
      const campaignId = await seedCampaign();
      const a = await seedRecipient(campaignId, await seedContact());
      const b = await seedRecipient(campaignId, await seedContact());

      await click(a.messageId, REPORT_LINK);
      await click(b.messageId, UNSUBSCRIBE_LINK);

      const row = await campaignRow(campaignId);
      expect(row.clickedCount).toBe(0);
      // 눌렀다는 것은 열었다는 것이다 — 링크 종류와 무관하게 열람으로 오른다.
      expect(row.openedCount).toBe(2);
    });

    it('같은 사람이 설문 링크를 여러 번 눌러도 사람 수로 센다', async () => {
      const campaignId = await seedCampaign();
      const a = await seedRecipient(campaignId, await seedContact());
      const b = await seedRecipient(campaignId, await seedContact());

      await click(a.messageId, SURVEY_LINK);
      await click(a.messageId, SURVEY_LINK, { at: '2026-11-21T01:00:00.000Z' });
      await click(b.messageId, `${APP}/i/AbCdEf1234`);

      const row = await campaignRow(campaignId);
      expect(row.clickedCount).toBe(2);
      expect(row.openedCount).toBe(2);
    });

    it('같은 알림이 두 번 와도 한 번만 반영한다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());
      const id = `evt-${randomUUID()}`;

      expect(await click(messageId, SURVEY_LINK, { id })).toBe('processed');
      expect(await click(messageId, SURVEY_LINK, { id })).toBe('deduped');

      expect((await campaignRow(campaignId)).openedCount).toBe(1);
      expect(await storedClicks(recipientId)).toHaveLength(1);
    });

    it('이미 반송된 수신자가 눌러도 기록은 남고 수신 상황은 그대로다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(
        campaignId,
        await seedContact(),
        'bounced',
      );

      await click(messageId, SURVEY_LINK);

      const row = await campaignRow(campaignId);
      expect(row.clickedCount).toBe(1);
      expect(row.openedCount).toBe(0);
      expect(await recipientStatus(campaignId, recipientId)).toBe('bounced');
    });

    it('회신 전달·답장 중계 메일의 클릭은 기록하지 않는다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());

      await click(messageId, SURVEY_LINK, { tags: { kind: 'reply-forward' } });
      await click(messageId, SURVEY_LINK, { tags: { kind: 'reply-relay' } });

      const row = await campaignRow(campaignId);
      expect(row.clickedCount).toBe(0);
      expect(row.openedCount).toBe(0);
      expect(await recipientStatus(campaignId, recipientId)).toBe('delivered');
    });

    describe('수신자당 상한', () => {
      /** 그 밖의 링크 클릭으로 상한을 채운 수신자. */
      async function seedRecipientAtCap() {
        const campaignId = await seedCampaign();
        const seeded = await seedRecipient(campaignId, await seedContact());
        await db.insert(mailLinkClicks).values(
          Array.from({ length: MAX_CLICKS_PER_RECIPIENT }, () => ({
            recipientId: seeded.recipientId,
            linkKind: 'other' as const,
            linkUrl: REPORT_LINK,
            clickedAt: new Date('2026-11-20T05:00:00.000Z'),
          })),
        );
        return { campaignId, ...seeded };
      }

      it('상한이 찬 뒤의 클릭은 줄을 늘리지 않고 경고를 남긴다', async () => {
        const { recipientId, messageId } = await seedRecipientAtCap();
        const warn = vi.spyOn(logger, 'warn');

        expect(await click(messageId, REPORT_LINK)).toBe('processed');

        expect(await storedClicks(recipientId)).toHaveLength(MAX_CLICKS_PER_RECIPIENT);
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ recipientId }),
          expect.stringContaining('상한'),
        );
        // 로그에는 식별자만 — 주소·IP·브라우저 정보를 싣지 않는다.
        expect(JSON.stringify(warn.mock.calls)).not.toContain('spri.kr');
        expect(JSON.stringify(warn.mock.calls)).not.toContain('203.0.113.7');
        warn.mockRestore();
      });

      it('상한이 찼어도 첫 설문 링크 클릭은 남긴다 — 설문에 들어온 사람이 「없음」으로 남지 않게', async () => {
        const { campaignId, recipientId, messageId } = await seedRecipientAtCap();

        await click(messageId, SURVEY_LINK);
        await click(messageId, SURVEY_LINK, { at: '2026-11-21T00:00:00.000Z' });

        expect((await campaignRow(campaignId)).clickedCount).toBe(1);
        // 첫 설문 링크 클릭 한 줄만 늘고, 그 뒤 클릭은 다시 버린다.
        expect(await storedClicks(recipientId)).toHaveLength(MAX_CLICKS_PER_RECIPIENT + 1);
      });
    });

    it('앱 주소 설정이 없으면 기록하지 않고 실패한다 — 설정을 고친 뒤 재전송이 처리된다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());
      const id = `evt-${randomUUID()}`;

      delete process.env['NEXT_PUBLIC_APP_URL'];
      try {
        await expect(click(messageId, `${APP}/i/AbCdEf1234`, { id })).rejects.toThrow();
      } finally {
        process.env['NEXT_PUBLIC_APP_URL'] = APP;
      }
      expect(await storedClicks(recipientId)).toHaveLength(0);
      expect(await recipientStatus(campaignId, recipientId)).toBe('delivered');

      // 실패한 알림은 장부에도 남지 않는다 — 같은 알림이 다시 오면 처음부터 처리한다.
      expect(await click(messageId, `${APP}/i/AbCdEf1234`, { id })).toBe('processed');
      expect((await storedClicks(recipientId)).map((c) => c.linkKind)).toEqual(['survey']);
    });

    it('클릭 정보가 빠진 알림은 줄 없이 열람으로만 올리고 경고를 남긴다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());
      const warn = vi.spyOn(logger, 'warn');

      const result = await processResendWebhookEvent({
        id: `evt-${randomUUID()}`,
        type: 'email.clicked',
        createdAt: '2026-11-20T05:00:00.000Z',
        resendMessageId: messageId,
        click: null,
      });

      expect(result).toBe('processed');
      expect(await storedClicks(recipientId)).toHaveLength(0);
      expect(await recipientStatus(campaignId, recipientId)).toBe('opened');
      // 발송 서비스가 알림 모양을 바꾸면 클릭 기록이 통째로 사라진다 — 조용히 넘어가지 않는다.
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId }),
        expect.stringContaining('클릭 정보'),
      );
      warn.mockRestore();
    });

    it('보관된 수신자의 클릭은 세지 않는다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());
      await click(messageId, SURVEY_LINK);
      expect((await campaignRow(campaignId)).clickedCount).toBe(1);

      await db
        .update(mailRecipients)
        .set({ archivedAt: new Date() })
        .where(eq(mailRecipients.id, recipientId));

      expect((await campaignRow(campaignId)).clickedCount).toBe(0);
    });
  });

  describe('수신자 표의 「링크 클릭」', () => {
    async function recipientRow(campaignId: string, recipientId: string) {
      const { rows } = await listCampaignRecipients({
        surveyId,
        campaignId,
        scope: 'real',
        pageSize: 100,
      });
      const row = rows.find((r) => r.id === recipientId);
      if (!row) throw new Error('수신자가 표에 없다');
      return row;
    }

    it('누른 링크 종류마다 첫 클릭 시각을 한 줄로 보인다 — 그 밖의 링크는 주소도', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());

      await click(messageId, REPORT_LINK, { at: '2026-11-20T05:10:00.000Z' });
      await click(messageId, SURVEY_LINK, { at: '2026-11-21T02:00:00.000Z' });
      await click(messageId, SURVEY_LINK, { at: '2026-11-20T05:03:10.000Z' });
      await click(messageId, UNSUBSCRIBE_LINK, { at: '2026-11-22T00:00:00.000Z' });

      const row = await recipientRow(campaignId, recipientId);
      expect(row.linkClicks).toEqual([
        { kind: 'survey', url: null, firstClickedAt: new Date('2026-11-20T05:03:10.000Z') },
        { kind: 'unsubscribe', url: null, firstClickedAt: new Date('2026-11-22T00:00:00.000Z') },
        { kind: 'other', url: REPORT_LINK, firstClickedAt: new Date('2026-11-20T05:10:00.000Z') },
      ]);
    });

    it('그 밖의 링크는 주소마다 한 줄이다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());
      const guide = 'https://example.org/guide';

      await click(messageId, guide, { at: '2026-11-20T06:00:00.000Z' });
      await click(messageId, REPORT_LINK, { at: '2026-11-20T05:10:00.000Z' });
      await click(messageId, REPORT_LINK, { at: '2026-11-20T07:00:00.000Z' });

      const row = await recipientRow(campaignId, recipientId);
      expect(row.linkClicks).toEqual([
        { kind: 'other', url: REPORT_LINK, firstClickedAt: new Date('2026-11-20T05:10:00.000Z') },
        { kind: 'other', url: guide, firstClickedAt: new Date('2026-11-20T06:00:00.000Z') },
      ]);
    });

    it('누른 것이 없는 수신자는 빈 목록이고, 남의 클릭이 섞이지 않는다', async () => {
      const campaignId = await seedCampaign();
      const quiet = await seedRecipient(campaignId, await seedContact());
      const clicker = await seedRecipient(campaignId, await seedContact());

      await click(clicker.messageId, SURVEY_LINK);

      expect((await recipientRow(campaignId, quiet.recipientId)).linkClicks).toEqual([]);
      expect((await recipientRow(campaignId, clicker.recipientId)).linkClicks).toHaveLength(1);
    });

    it('IP 해시와 브라우저 정보는 행에 싣지 않는다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());
      await click(messageId, SURVEY_LINK, { ip: '198.51.100.99', ua: 'SecretAgent/1.0' });

      const row = await recipientRow(campaignId, recipientId);
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain('SecretAgent');
      expect(serialized).not.toContain(saltedHash('198.51.100.99'));
    });
  });

  describe('조사 대상 목록의 「링크 클릭」', () => {
    /** 조사 대상 목록이 그 대상에 보이는 링크 클릭 상태. */
    async function linkClickOf(contactId: string) {
      const { rows } = await listContactsForSurvey({
        surveyId,
        scope: 'real',
        filter: resolvedFilterForTest(),
        page: 1,
        pageSize: 500,
        sort: 'resid',
        dir: 'asc',
      });
      const row = rows.find((r) => r.id === contactId);
      if (!row) throw new Error('대상이 목록에 없다');
      return row.linkClick;
    }

    it('설문 링크를 누른 대상은 있음, 발송 이력만 있는 대상은 없음, 발송 이력이 없으면 null 이다', async () => {
      const campaignId = await seedCampaign();
      const clicker = await seedContact();
      const quiet = await seedContact();
      const neverMailed = await seedContact();
      const { messageId } = await seedRecipient(campaignId, clicker);
      await seedRecipient(campaignId, quiet);

      await click(messageId, SURVEY_LINK);

      expect(await linkClickOf(clicker)).toBe('clicked');
      expect(await linkClickOf(quiet)).toBe('not_clicked');
      expect(await linkClickOf(neverMailed)).toBeNull();
    });

    it('그 밖의 링크나 수신거부 링크만 누른 대상은 없음이다', async () => {
      const campaignId = await seedCampaign();
      const reportOnly = await seedContact();
      const unsubscribeOnly = await seedContact();
      const a = await seedRecipient(campaignId, reportOnly);
      const b = await seedRecipient(campaignId, unsubscribeOnly);

      await click(a.messageId, REPORT_LINK);
      await click(b.messageId, UNSUBSCRIBE_LINK);

      expect(await linkClickOf(reportOnly)).toBe('not_clicked');
      expect(await linkClickOf(unsubscribeOnly)).toBe('not_clicked');
    });

    it('어느 회차에서 눌렀든 있음이다 — 나중 회차에서 누르지 않아도', async () => {
      const first = await seedCampaign();
      const second = await seedCampaign();
      const contactId = await seedContact();
      const { messageId } = await seedRecipient(first, contactId);
      await seedRecipient(second, contactId);

      await click(messageId, SURVEY_LINK);

      expect(await linkClickOf(contactId)).toBe('clicked');
    });

    it('보관한 회차의 클릭은 빼고, 그 회차뿐이던 대상은 발송 이력 없음으로 돌아간다', async () => {
      const archived = await seedCampaign();
      const kept = await seedCampaign();
      const onlyArchived = await seedContact();
      const both = await seedContact();
      const a = await seedRecipient(archived, onlyArchived);
      const b = await seedRecipient(archived, both);
      await seedRecipient(kept, both);
      await click(a.messageId, SURVEY_LINK);
      await click(b.messageId, SURVEY_LINK);

      await db
        .update(mailCampaigns)
        .set({ archivedAt: new Date() })
        .where(eq(mailCampaigns.id, archived));

      expect(await linkClickOf(onlyArchived)).toBeNull();
      expect(await linkClickOf(both)).toBe('not_clicked');
    });

    it('대체 발송 회차에서 누른 것도 그 대상의 클릭이다', async () => {
      const parent = await seedCampaign();
      const contactId = await seedContact();
      await seedRecipient(parent, contactId, 'bounced');
      // 반송 뒤 다음 순위 주소로 간 대체 회차 — 별도 회차·별도 수신자 행이다.
      const fallback = randomUUID();
      await db.insert(mailCampaigns).values({
        id: fallback,
        surveyId,
        runNumber: 2_000_000 + runNumber,
        kind: 'fallback',
        parentCampaignId: parent,
        title: '대체 발송',
        subjectSnapshot: '제목',
        bodyHtmlSnapshot: '<p>본문</p>',
        fromLocalSnapshot: 'survey',
        fromNameSnapshot: '조사',
        status: 'completed',
      });
      const { messageId } = await seedRecipient(fallback, contactId);

      await click(messageId, SURVEY_LINK);

      expect(await linkClickOf(contactId)).toBe('clicked');
    });

    it('테스트 파티션의 회차에서 누른 것은 실데이터 대상의 클릭이 아니다', async () => {
      const contactId = await seedContact();
      const testCampaign = randomUUID();
      await db.insert(mailCampaigns).values({
        id: testCampaign,
        surveyId,
        runNumber: 9_000 + runNumber,
        isTest: true,
        title: '테스트 회차',
        subjectSnapshot: '제목',
        bodyHtmlSnapshot: '<p>본문</p>',
        fromLocalSnapshot: 'survey',
        fromNameSnapshot: '조사',
        status: 'completed',
      });
      const { messageId } = await seedRecipient(testCampaign, contactId);

      await click(messageId, SURVEY_LINK);

      // 수신 상황과 같은 범위 — 다른 파티션의 발송은 이 대상의 발송 이력이 아니다.
      expect(await linkClickOf(contactId)).toBeNull();
    });

    it('엑셀 조회도 같은 값을 싣는다', async () => {
      const campaignId = await seedCampaign();
      const clicker = await seedContact();
      const quiet = await seedContact();
      const { messageId } = await seedRecipient(campaignId, clicker);
      await seedRecipient(campaignId, quiet);
      await click(messageId, SURVEY_LINK);

      const rows = await listContactsForExport(surveyId, 'real');

      expect(rows.find((r) => r.id === clicker)?.linkClick).toBe('clicked');
      expect(rows.find((r) => r.id === quiet)?.linkClick).toBe('not_clicked');
    });
  });

  describe('조사 대상 목록에서 「링크 클릭」으로 거르기', () => {
    /** 주소의 필터 매개변수로 조사 대상 목록을 읽어, 걸린 대상 id 를 돌려준다. */
    async function filteredIds(params: ContactListFilterParams, mode: 'read' | 'write' = 'read') {
      const ctx = await loadContactFilterContext(surveyId, 'real', {
        isExternal: false,
        surface: 'contacts',
        share: FIELDWORK_SHARE_ALL,
      });
      const filter = await resolveContactFilter(ctx, contactFilterInputFromUrl(params), { mode });
      const { rows } = await listContactsForSurvey({
        surveyId,
        scope: 'real',
        filter,
        page: 1,
        pageSize: 500,
        sort: 'resid',
        dir: 'asc',
      });
      return { ids: rows.map((r) => r.id), unresolved: filter.unresolved };
    }

    const header = (...values: string[]): ContactListFilterParams => ({
      hcol: 'system.link_click',
      hm: 'in',
      hv: values.join(HEADER_FILTER_VALUE_SEPARATOR),
    });

    /** 눌렀다 · 받았지만 누르지 않았다 · 받은 적 없다 — 한 벌. */
    async function seedTrio() {
      const campaignId = await seedCampaign();
      const clicker = await seedContact();
      const quiet = await seedContact();
      const neverMailed = await seedContact();
      const { messageId } = await seedRecipient(campaignId, clicker);
      await seedRecipient(campaignId, quiet);
      await click(messageId, SURVEY_LINK);
      return { clicker, quiet, neverMailed };
    }

    it('있음 · 없음 · 발송 이력 없음이 각각 그 대상만 고른다', async () => {
      const { clicker, quiet, neverMailed } = await seedTrio();
      const pick = (ids: string[]) => [clicker, quiet, neverMailed].filter((id) => ids.includes(id));

      expect(pick((await filteredIds(header('clicked'))).ids)).toEqual([clicker]);
      expect(pick((await filteredIds(header('not_clicked'))).ids)).toEqual([quiet]);
      expect(pick((await filteredIds(header('none'))).ids)).toEqual([neverMailed]);
    });

    it('여러 값을 함께 고르면 「또는」이다', async () => {
      const { clicker, quiet, neverMailed } = await seedTrio();

      const { ids } = await filteredIds(header('clicked', 'none'));

      expect(ids).toContain(clicker);
      expect(ids).toContain(neverMailed);
      expect(ids).not.toContain(quiet);
    });

    it('「수신 상황」 필터와 함께 걸면 「그리고」다 — 전달 완료·열람이면서 클릭 없음', async () => {
      const campaignId = await seedCampaign();
      const delivered = await seedContact();
      const bounced = await seedContact();
      const clicker = await seedContact();
      await seedRecipient(campaignId, delivered, 'delivered');
      await seedRecipient(campaignId, bounced, 'bounced');
      const { messageId } = await seedRecipient(campaignId, clicker, 'delivered');
      await click(messageId, SURVEY_LINK);

      const { ids } = await filteredIds({
        hcol: ['system.email_count', 'system.link_click'],
        hm: ['in', 'in'],
        hv: [['delivered', 'opened'].join(HEADER_FILTER_VALUE_SEPARATOR), 'not_clicked'],
      });

      expect(ids).toContain(delivered);
      expect(ids).not.toContain(bounced);
      expect(ids).not.toContain(clicker);
    });

    it('검색 조건 줄로도 고른다', async () => {
      const { clicker, quiet, neverMailed } = await seedTrio();

      const { ids } = await filteredIds({ col: 'system.link_click', q: 'not_clicked' });

      expect(ids).toContain(quiet);
      expect(ids).not.toContain(clicker);
      expect(ids).not.toContain(neverMailed);
    });

    it('아는 값과 모르는 값이 섞이면 아는 값만 건다', async () => {
      const { clicker, quiet } = await seedTrio();

      const { ids, unresolved } = await filteredIds(header('responded', 'clicked'));

      expect(unresolved).toEqual([]);
      expect(ids).toContain(clicker);
      expect(ids).not.toContain(quiet);
    });

    it('검색 조건 줄의 모르는 값도 읽을 때 버리고 알리며, 쓰기에서는 거부한다', async () => {
      const { clicker, quiet } = await seedTrio();
      const params = { col: 'system.link_click', q: '응답함' };

      const read = await filteredIds(params);
      expect(read.unresolved).toHaveLength(1);
      expect(read.ids).toContain(clicker);
      expect(read.ids).toContain(quiet);

      await expect(filteredIds(params, 'write')).rejects.toThrow();
    });

    it('모르는 값은 읽을 때 버리고 알리며, 대상을 고르는 쓰기에서는 거부한다', async () => {
      const { clicker, quiet } = await seedTrio();

      const read = await filteredIds(header('responded'));
      expect(read.unresolved).toHaveLength(1);
      expect(read.ids).toContain(clicker);
      expect(read.ids).toContain(quiet);

      await expect(filteredIds(header('responded'), 'write')).rejects.toThrow();
    });
  });

  describe('단체 메일 위저드의 「링크 클릭」', () => {
    const NOT_CLICKED = {
      clauses: [],
      headerClauses: [{ source: 'system.link_click', mode: 'in' as const, hv: 'not_clicked' }],
    };

    /** 위저드 미리보기 표가 그 조건으로 보이는 후보. */
    async function preview(input: typeof NOT_CLICKED | { clauses: []; headerClauses: [] }) {
      const ctx = await loadContactFilterContext(surveyId, 'real', {
        isExternal: false,
        surface: 'mail',
        share: FIELDWORK_SHARE_ALL,
      });
      const filter = await resolveContactFilter(ctx, input, { mode: 'read' });
      const [result, total] = await Promise.all([
        previewCampaignCandidates({
          surveyId,
          scope: 'real',
          filter,
          unrespondedOnly: false,
          page: 1,
          pageSize: 500,
        }),
        countCampaignCandidates({ surveyId, scope: 'real', filter, unrespondedOnly: false }),
      ]);
      return { rows: result.rows, total, unresolved: filter.unresolved };
    }

    async function seedTrio() {
      const campaignId = await seedCampaign();
      const clicker = await seedContact();
      const quiet = await seedContact();
      const neverMailed = await seedContact();
      const { messageId } = await seedRecipient(campaignId, clicker);
      await seedRecipient(campaignId, quiet);
      await click(messageId, SURVEY_LINK);
      return { clicker, quiet, neverMailed };
    }

    it('미리보기 표의 후보마다 링크 클릭 상태를 싣는다', async () => {
      const { clicker, quiet, neverMailed } = await seedTrio();

      const { rows } = await preview({ clauses: [], headerClauses: [] });

      expect(rows.find((r) => r.id === clicker)?.linkClick).toBe('clicked');
      expect(rows.find((r) => r.id === quiet)?.linkClick).toBe('not_clicked');
      expect(rows.find((r) => r.id === neverMailed)?.linkClick).toBeNull();
    });

    it('「없음」으로 거르면 받았지만 누르지 않은 대상만 남고, 인원 수도 같다', async () => {
      const { clicker, quiet, neverMailed } = await seedTrio();

      const { rows, total, unresolved } = await preview(NOT_CLICKED);
      const ids = rows.map((r) => r.id);

      expect(unresolved).toEqual([]);
      expect(ids).toContain(quiet);
      expect(ids).not.toContain(clicker);
      expect(ids).not.toContain(neverMailed);
      expect(total).toBe(ids.length);
      expect(rows.every((r) => r.linkClick === 'not_clicked')).toBe(true);
    });

    it('「필터 결과 전체 선택」이 미리보기와 같은 대상을 고른다 — 발송 대상이 된다', async () => {
      const { clicker, quiet } = await seedTrio();

      const shown = await preview(NOT_CLICKED);
      const selected = await fetchCandidateIds({ surveyId, filter: NOT_CLICKED }, false);

      expect([...selected.ids].sort()).toEqual(shown.rows.map((r) => r.id).sort());
      expect(selected.ids).toContain(quiet);
      expect(selected.ids).not.toContain(clicker);
    });

    it('수신거부한 대상은 누르지 않았어도 후보에서 빠진다 — 기존 제외 규칙이 함께 걸린다', async () => {
      const campaignId = await seedCampaign();
      const unsubscribed = await seedContact();
      await seedRecipient(campaignId, unsubscribed);
      await db
        .update(contactTargets)
        .set({ unsubscribedAt: new Date() })
        .where(eq(contactTargets.id, unsubscribed));

      const { rows } = await preview(NOT_CLICKED);

      expect(rows.map((r) => r.id)).not.toContain(unsubscribed);
    });
  });

  describe('컨택원 교체 적용 조건 (범위 밖)', () => {
    async function assignmentContext() {
      return loadContactFilterContext(surveyId, 'real', {
        isExternal: false,
        surface: 'assignments',
        share: FIELDWORK_SHARE_ALL,
      });
    }

    it('조건 후보에 「링크 클릭」이 없다 — 「메일」 열은 그대로 있다', async () => {
      const sources = (await assignmentContext()).columnCandidates.map((c) => c.source);

      expect(sources).toContain('system.email_count');
      expect(sources).not.toContain('system.link_click');
    });

    it('링크 클릭 조건이 직접 들어오면 넓혀서 적용하지 않고 거부한다', async () => {
      const ctx = await assignmentContext();

      await expect(
        resolveContactFilter(
          ctx,
          { clauses: [{ source: 'system.link_click', value: 'not_clicked', op: '' }] },
          { mode: 'write' },
        ),
      ).rejects.toThrow();
    });
  });

  describe('남기는 것과 남기지 않는 것', () => {
    it('설문·수신거부 주소는 남기지 않고 그 밖의 링크만 주소를 남긴다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());

      await click(messageId, `${SURVEY_LINK}?invite=3f0c6c1e-0000-4000-8000-000000000009`);
      await click(messageId, UNSUBSCRIBE_LINK);
      await click(messageId, REPORT_LINK);

      const stored = await storedClicks(recipientId);
      expect(
        stored
          .map((c) => ({ kind: c.linkKind, url: c.linkUrl }))
          .sort((a, b) => a.kind.localeCompare(b.kind)),
      ).toEqual([
        { kind: 'other', url: REPORT_LINK },
        { kind: 'survey', url: null },
        { kind: 'unsubscribe', url: null },
      ]);
    });

    it('IP 는 원문 없이 응답과 같은 식의 해시로 남고, 클릭 시각과 브라우저 정보를 남긴다', async () => {
      const campaignId = await seedCampaign();
      const { recipientId, messageId } = await seedRecipient(campaignId, await seedContact());

      await click(messageId, SURVEY_LINK, {
        ip: '198.51.100.23',
        ua: 'Mozilla/5.0 (Windows NT 10.0)',
        at: '2026-11-20T05:03:10.000Z',
      });

      const [stored] = await storedClicks(recipientId);
      // 응답의 ip_hash 가 쓰는 식(saltedHash) — 같은 IP 로 시작한 응답과 맞춰 볼 수 있어야 한다.
      expect(stored?.ipHash).toBe(saltedHash('198.51.100.23'));
      expect(stored?.ipHash).not.toContain('198.51.100.23');
      expect(stored?.userAgent).toBe('Mozilla/5.0 (Windows NT 10.0)');
      expect(stored?.clickedAt.toISOString()).toBe('2026-11-20T05:03:10.000Z');
    });
  });
});
