import 'server-only';

import { asc, gt } from 'drizzle-orm';

import { db } from '@/db';
import { mailCampaigns } from '@/db/schema';
import { extractMailContentKeys } from '@/lib/r2-lifecycle/key-extract';
import { recordSentKeys } from '@/lib/r2-lifecycle/sent-ledger.server';

/** 커서 배치 크기 — 캠페인 스냅샷(bodyHtml)이 커서 500행 단위로 순회한다. */
const SEED_BATCH_SIZE = 500;

/** 커서 순회 행 — 명시 타입으로 cursor ↔ rows 순환 추론(TS7022)을 끊는다. */
interface CampaignSnapshotRow {
  id: string;
  bodyHtmlSnapshot: string;
  attachmentsSnapshot: unknown;
}

/**
 * 발송 장부 1회 시딩 — 기존 mail_campaigns 전수(아카이브 여부 무관, isTest
 * 포함)의 bodyHtmlSnapshot·attachmentsSnapshot 에서 R2 키를 추출해 장부에
 * 기록한다. 장부 도입 이전 발송분이 설문 hard delete 의 캠페인 스냅샷 CASCADE
 * 소멸 후에도 보호되게 하는 배포 시 1회 이관이다 (PRD "발송 장부 기록 + 1회
 * 시딩" 절). 재실행 멱등 — recordSentKeys 가 중복 키를 무시한다.
 */
export async function seedSentLedgerFromCampaignSnapshots(): Promise<{
  campaigns: number;
  recorded: number;
}> {
  let campaigns = 0;
  let recorded = 0;
  let cursor: string | null = null;

  for (;;) {
    const rows: CampaignSnapshotRow[] = await db
      .select({
        id: mailCampaigns.id,
        bodyHtmlSnapshot: mailCampaigns.bodyHtmlSnapshot,
        attachmentsSnapshot: mailCampaigns.attachmentsSnapshot,
      })
      .from(mailCampaigns)
      .where(cursor === null ? undefined : gt(mailCampaigns.id, cursor))
      .orderBy(asc(mailCampaigns.id))
      .limit(SEED_BATCH_SIZE);
    if (rows.length === 0) break;

    const keys = new Set<string>();
    for (const row of rows) {
      const extracted = extractMailContentKeys({
        bodyHtml: row.bodyHtmlSnapshot,
        attachments: row.attachmentsSnapshot,
      });
      for (const key of extracted) keys.add(key);
    }

    campaigns += rows.length;
    recorded += await recordSentKeys(db, [...keys]);

    const last = rows[rows.length - 1];
    if (!last || rows.length < SEED_BATCH_SIZE) break;
    cursor = last.id;
  }

  return { campaigns, recorded };
}
