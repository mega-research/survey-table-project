/**
 * 발송 장부 1회 시딩 — 실DB 왕복 계약 테스트 (이슈 04).
 *
 * 계약:
 * - mail_campaigns 전수(isTest 포함)의 bodyHtmlSnapshot·attachmentsSnapshot 에서
 *   키를 추출해 r2_sent_keys 에 기록한다 (tmp/외부 도메인 제외)
 * - 재실행 멱등 — 두 번째 실행은 신규 기록 0, 행 수 불변
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 + 0065 마이그레이션 적용 필요)
 * prior art: r2-deletion-queue.realdb.test.ts 의 isLocalDb skipIf 패턴.
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { mailCampaigns, r2SentKeys, surveys } from '@/db/schema';
import { seedSentLedgerFromCampaignSnapshots } from '@/server/storage-lifecycle/sent-ledger-seed';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const KNOWN_HOST = 'https://cdn-dev.megaresearch.co.kr';
const runId = crypto.randomUUID().slice(0, 8);
const surveyId = crypto.randomUUID();

const bodyKey = `mail/seed-${runId}/hero.png`;
const fullKey = `mail/seed-${runId}/full.png`;
const bandKey1 = `mail/seed-${runId}/band-1.png`;
const bandKey2 = `mail/seed-${runId}/band-2.png`;
const attachmentKey = `mail-attachment/seed-${runId}/doc.pdf`;
const testCampaignKey = `mail/seed-${runId}/test-run.png`;
const expectedKeys = [bodyKey, fullKey, bandKey1, bandKey2, attachmentKey, testCampaignKey];

/** 이 테스트가 만든 키만 조회 — 병행 realdb 파일의 장부 기록과 간섭하지 않는다. */
async function ownLedgerRows(): Promise<Array<{ key: string; firstSentAt: Date }>> {
  return db
    .select({ key: r2SentKeys.key, firstSentAt: r2SentKeys.firstSentAt })
    .from(r2SentKeys)
    .where(inArray(r2SentKeys.key, expectedKeys));
}

describe.skipIf(!isLocalDb)('발송 장부 시딩 실DB 왕복', () => {
  afterAll(async () => {
    await db.delete(surveys).where(eq(surveys.id, surveyId));
    await db.delete(r2SentKeys).where(inArray(r2SentKeys.key, expectedKeys));
  });

  it('캠페인 스냅샷 전수에서 키를 추출해 기록하고, 재실행은 멱등이다', async () => {
    await db.insert(surveys).values({ id: surveyId, title: '장부 시딩 실DB 테스트' });
    await db.insert(mailCampaigns).values([
      {
        surveyId,
        runNumber: 1,
        title: '시딩 대상 본발송',
        subjectSnapshot: '제목',
        bodyHtmlSnapshot:
          `<p><img src="${KNOWN_HOST}/${bodyKey}"></p>`
          + `<img src="${KNOWN_HOST}/${fullKey}"`
          + ` data-link-bands="${KNOWN_HOST}/${bandKey1}|${KNOWN_HOST}/${bandKey2}">`
          + `<img src="${KNOWN_HOST}/tmp/mail/seed-${runId}/draft.png">`
          + '<img src="https://external.example.com/mail/evil.png">',
        fromLocalSnapshot: 'noreply',
        fromNameSnapshot: '발신자',
        attachmentsSnapshot: [
          { key: attachmentKey, filename: 'doc.pdf', size: 100, mime: 'application/pdf' },
        ],
      },
      {
        surveyId,
        runNumber: 1,
        isTest: true,
        title: '시딩 대상 테스트 발송',
        subjectSnapshot: '테스트 제목',
        bodyHtmlSnapshot: `<img src="${KNOWN_HOST}/${testCampaignKey}">`,
        fromLocalSnapshot: 'noreply',
        fromNameSnapshot: '발신자',
      },
    ]);

    const first = await seedSentLedgerFromCampaignSnapshots();
    expect(first.campaigns).toBeGreaterThanOrEqual(2);
    expect(first.recorded).toBeGreaterThanOrEqual(expectedKeys.length);

    const rows = await ownLedgerRows();
    expect(rows.map((r) => r.key).sort()).toEqual([...expectedKeys].sort());

    // tmp/외부 도메인 키는 기록되지 않는다
    const rejected = await db
      .select({ key: r2SentKeys.key })
      .from(r2SentKeys)
      .where(inArray(r2SentKeys.key, [`tmp/mail/seed-${runId}/draft.png`, 'mail/evil.png']));
    expect(rejected).toEqual([]);

    // 재실행 멱등 — 이 테스트 키 스코프에서 행 수 불변 + 최초 발송 시각 보존.
    // (병행 realdb 파일이 캠페인·장부 행을 동시 삽입할 수 있어 전역 건수 단언은
    // flaky — recorded 전역값 대신 스코프 불변으로 멱등을 고정한다)
    const firstSentAtByKey = new Map(rows.map((r) => [r.key, r.firstSentAt.getTime()]));
    const second = await seedSentLedgerFromCampaignSnapshots();
    expect(second.campaigns).toBeGreaterThanOrEqual(2);

    const rowsAfter = await ownLedgerRows();
    expect(rowsAfter.length).toBe(expectedKeys.length);
    for (const row of rowsAfter) {
      expect(row.firstSentAt.getTime()).toBe(firstSentAtByKey.get(row.key));
    }
  });
});
