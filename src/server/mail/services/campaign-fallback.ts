import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import { contactPii, contactTargets } from '@/db/schema/contacts';
import { mailCampaigns, mailRecipients } from '@/db/schema/mail';
import { decryptPii } from '@/lib/crypto/aes';
import { blindIndex } from '@/lib/crypto/blind';
import { emailColumnCandidateSql, emailColumnOrderSql } from '@/lib/crypto/contact-pii-repo';
import { inngest } from '@/lib/inngest/client';
import { logger } from '@/lib/logger';
import {
  type FallbackEmailCandidate,
  fallbackCampaignTitle,
  pickFallbackAddress,
} from '@/lib/mail/fallback-address';
import { latestResultUnsubscribedSql } from '@/lib/operations/contacts-filter-sql.server';
import { loadMailEmailOrder } from '@/server/read-models/mail-email-order';
import {
  buildNegativeCodeExists,
  getResultCodeStatuses,
} from '@/server/read-models/result-code-statuses';
import type { MailRecipientStatus } from '@/shared/contracts/mail';

import { listBouncedEmailBlindIndexes } from './campaigns-read';
import { triggersFallback } from './recipient-status-transition';

/**
 * 대체 발송 — 수신자가 실패(발송 거부)·반송되면 발송 주소 순서의 다음 이메일 열로 자동 재발송한다 (2026-10-16).
 *
 * 원래 회차(부모) 아래 kind='fallback' 회차를 하나 붙이고 그 회차의 수신자로 넣은 뒤 `mail/campaign.queued` 를
 * 다시 낸다 — 발송·lease·webhook·집계는 기존 장치를 그대로 탄다. 대체 발송이 또 실패·반송되면 그 대체 회차의
 * 자식 대체 회차로 이어진다(3순위 …). 수신자 한 줄 = (회차, 조사 대상) 유일 제약이라 같은 회차에는 쌓지 않는다.
 *
 * 다시 보내지 않는 경우: 그사이 응답을 마쳤거나, 수신거부·스팸 신고(신고는 수신거부로 수렴)했거나, 연락 금지
 * 결과코드가 붙었거나, 회차가 취소·보관됐거나, 다음 순위 주소가 없을 때. 같은 수신자로 여러 번 불려도
 * 대체 회차에 한 줄만 생긴다(유일 제약 + ON CONFLICT) — webhook 재전송·dispatch 재시도에 안전하다.
 */

/** 대체 발송 사슬을 거슬러 올라가는 깊이 상한 — 이메일 열 수보다 넉넉하게. */
const MAX_CHAIN_DEPTH = 20;

interface QueuedFallback {
  campaignId: string;
  surveyId: string;
}

/**
 * 수신자 하나의 대체 발송 처리 — 대체 회차에 넣거나 보내지 않기로 판정하고, 같은 트랜잭션에서
 * 처리 대기 표식(fallback_pending_at)을 지운다. 표식이 없으면 이미 처리됐거나 처리할 것이 없는
 * 수신자라 아무것도 하지 않는다 — 즉시 경로와 정기 점검이 겹쳐 불러도 한 번만 처리된다.
 * 도중에 실패하면 트랜잭션째 되돌려져 표식이 남고, 정기 점검이 다시 부른다.
 */
async function queueRecipientFallback(sourceRecipientId: string): Promise<QueuedFallback | null> {
  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select({ campaignId: mailRecipients.campaignId })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, sourceRecipientId));
    if (!ref) return null;

    // 잠금 순서는 webhook·reconcile 과 같게 회차 → 수신자. 부모 회차 잠금은 같은 부모의 대체 회차를
    // 동시에 둘 만들지 않게 직렬화하고, 수신자 잠금은 같은 수신자를 두 번 처리하지 않게 한다.
    const [parent] = await tx
      .select()
      .from(mailCampaigns)
      .where(eq(mailCampaigns.id, ref.campaignId))
      .for('update');
    const [source] = await tx
      .select({
        id: mailRecipients.id,
        campaignId: mailRecipients.campaignId,
        contactTargetId: mailRecipients.contactTargetId,
        status: mailRecipients.status,
        archivedAt: mailRecipients.archivedAt,
        emailSnapshot: mailRecipients.emailSnapshot,
        emailColumnKey: mailRecipients.emailColumnKey,
        sourceRecipientId: mailRecipients.sourceRecipientId,
        fallbackPendingAt: mailRecipients.fallbackPendingAt,
      })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, sourceRecipientId))
      .for('update');
    if (!parent || !source || source.campaignId !== parent.id) return null;
    if (source.fallbackPendingAt === null) return null;

    const queued = await planRecipientFallback(tx, parent, source);
    await tx
      .update(mailRecipients)
      .set({ fallbackPendingAt: null })
      .where(eq(mailRecipients.id, source.id));
    return queued;
  });
}

type FallbackSource = {
  id: string;
  contactTargetId: string | null;
  status: string;
  archivedAt: Date | null;
  emailSnapshot: string | null;
  emailColumnKey: string | null;
  sourceRecipientId: string | null;
};

/** 대체 발송 판정과 등록 — 보내지 않기로 하면 null. 처리 대기 표식은 호출부가 지운다. */
async function planRecipientFallback(
  tx: DbTransaction,
  parent: typeof mailCampaigns.$inferSelect,
  source: FallbackSource,
): Promise<QueuedFallback | null> {
  if (!source.contactTargetId || source.archivedAt !== null) return null;
  if (!triggersFallback(source.status as MailRecipientStatus)) return null;
  if (parent.archivedAt !== null || parent.status === 'cancelled') return null;

  const { negative: negativeCodes } = await getResultCodeStatuses(parent.surveyId);
  const [contact] = await tx
    .select({
      id: contactTargets.id,
      isTest: contactTargets.isTest,
      inviteToken: contactTargets.inviteToken,
      unsubscribedAt: contactTargets.unsubscribedAt,
      respondedAt: contactTargets.respondedAt,
      resultUnsubscribed: sql<boolean>`${latestResultUnsubscribedSql}`,
      negativeCode: sql<boolean>`${buildNegativeCodeExists(negativeCodes, sql`"contact_targets"."id"`)}`,
    })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.id, source.contactTargetId),
        eq(contactTargets.surveyId, parent.surveyId),
      ),
    );
  if (!contact || contact.isTest !== parent.isTest) return null;
  if (contact.unsubscribedAt !== null || contact.respondedAt !== null) return null;
  if (contact.resultUnsubscribed || contact.negativeCode) return null;

  // 대체 발송 사슬에서 이미 보낸 주소 — 같은 주소로 다시 가지 않게.
  const triedEmails: string[] = source.emailSnapshot ? [source.emailSnapshot] : [];
  let ancestorId = source.sourceRecipientId;
  for (let depth = 0; ancestorId && depth < MAX_CHAIN_DEPTH; depth += 1) {
    const [ancestor] = await tx
      .select({
        emailSnapshot: mailRecipients.emailSnapshot,
        sourceRecipientId: mailRecipients.sourceRecipientId,
      })
      .from(mailRecipients)
      .where(eq(mailRecipients.id, ancestorId));
    if (!ancestor) break;
    if (ancestor.emailSnapshot) triedEmails.push(ancestor.emailSnapshot);
    ancestorId = ancestor.sourceRecipientId;
  }

  // 다음 순위 주소 — 발송(createCampaign)과 같은 순서·같은 후보 열.
  const order = await loadMailEmailOrder(parent.surveyId, parent.isTest, tx);
  const columnKey = sql`${contactPii.columnKey}`;
  const piiRows = await tx
    .select({
      columnKey: contactPii.columnKey,
      cipher: contactPii.cipher,
    })
    .from(contactPii)
    .where(
      and(
        eq(contactPii.contactTargetId, contact.id),
        eq(contactPii.fieldType, 'email'),
        emailColumnCandidateSql(columnKey, order),
      ),
    )
    .orderBy(asc(emailColumnOrderSql(columnKey, order)));
  const candidates: FallbackEmailCandidate[] = [];
  for (const row of piiRows) {
    try {
      const email = decryptPii(row.cipher);
      if (email.trim()) {
        candidates.push({ columnKey: row.columnKey, email });
      }
    } catch {
      // 복호화 실패 열은 후보에서 뺀다 — 발송(createCampaign)과 같은 규칙
    }
  }
  const bouncedBlindIndexes = new Set(await listBouncedEmailBlindIndexes(parent.surveyId));
  const next = pickFallbackAddress({
    candidates,
    usedColumnKey: source.emailColumnKey,
    usedEmail: source.emailSnapshot,
    triedEmails,
    isBouncedAddress: (address) => bouncedBlindIndexes.has(blindIndex('email', address)),
  });
  if (!next) return null;

  // 부모의 대체 회차 — 없으면 만든다. 내용은 부모 회차의 발송 스냅샷을 그대로 쓴다.
  let [fallback] = await tx
    .select({
      id: mailCampaigns.id,
      status: mailCampaigns.status,
      archivedAt: mailCampaigns.archivedAt,
    })
    .from(mailCampaigns)
    .where(and(eq(mailCampaigns.parentCampaignId, parent.id), eq(mailCampaigns.kind, 'fallback')))
    .for('update');
  if (!fallback) {
    const runRows = await tx.execute<{ next_id: number }>(
      sql`SELECT next_fallback_run_number(${parent.surveyId}, ${parent.isTest}) AS next_id`,
    );
    const runNumber = Number(runRows[0]?.next_id ?? 0);
    if (!runNumber) throw new Error('대체 발송 회차 번호 발급에 실패했습니다.');
    [fallback] = await tx
      .insert(mailCampaigns)
      .values({
        surveyId: parent.surveyId,
        isTest: parent.isTest,
        mailTemplateId: parent.mailTemplateId,
        runNumber,
        kind: 'fallback',
        parentCampaignId: parent.id,
        title: fallbackCampaignTitle(parent.title, parent.kind === 'fallback'),
        subjectSnapshot: parent.subjectSnapshot,
        bodyHtmlSnapshot: parent.bodyHtmlSnapshot,
        fromLocalSnapshot: parent.fromLocalSnapshot,
        fromNameSnapshot: parent.fromNameSnapshot,
        replyToSnapshot: parent.replyToSnapshot,
        attachmentsSnapshot: parent.attachmentsSnapshot,
        filterSnapshot: {},
        createdBy: parent.createdBy,
        status: 'queued',
      })
      .returning({
        id: mailCampaigns.id,
        status: mailCampaigns.status,
        archivedAt: mailCampaigns.archivedAt,
      });
    if (!fallback) throw new Error('대체 발송 회차 생성에 실패했습니다.');
  }
  if (fallback.archivedAt !== null || fallback.status === 'cancelled') return null;

  const inserted = await tx
    .insert(mailRecipients)
    .values({
      campaignId: fallback.id,
      contactTargetId: contact.id,
      emailSnapshot: next.email,
      emailColumnKey: next.columnKey,
      sourceRecipientId: source.id,
      inviteTokenSnapshot: contact.inviteToken,
      status: 'queued',
    })
    .onConflictDoNothing({ target: [mailRecipients.campaignId, mailRecipients.contactTargetId] })
    .returning({ id: mailRecipients.id });
  if (inserted.length === 0) return null;

  // 이미 끝난 대체 회차에 늦게 온 반송이면 다시 연다 — 발송기가 queued·sending 회차만 처리한다.
  await tx
    .update(mailCampaigns)
    .set({
      recipientCount: sql`${mailCampaigns.recipientCount} + 1`,
      queuedCount: sql`${mailCampaigns.queuedCount} + 1`,
      status: sql`CASE WHEN ${mailCampaigns.status} IN ('completed', 'partial') THEN 'queued' ELSE ${mailCampaigns.status} END`,
      completedAt: sql`CASE WHEN ${mailCampaigns.status} IN ('completed', 'partial') THEN NULL ELSE ${mailCampaigns.completedAt} END`,
      updatedAt: new Date(),
    })
    .where(eq(mailCampaigns.id, fallback.id));

  return { campaignId: fallback.id, surveyId: parent.surveyId };
}

/**
 * 실패·반송으로 바뀐 수신자들의 대체 발송을 건다 — 상태 전이가 커밋된 **뒤에** 부른다.
 * 대체 발송은 부가 동작이라 실패해도 호출부(webhook·reconcile·dispatch)를 깨지 않고 로그만 남긴다.
 * 실패한 수신자는 처리 대기 표식이 남아 정기 점검(`retryPendingRecipientFallbacks`)이 다시 부른다.
 */
export async function requestRecipientFallbacks(recipientIds: readonly string[]): Promise<void> {
  const queued = new Map<string, QueuedFallback>();
  for (const recipientId of new Set(recipientIds)) {
    try {
      const result = await queueRecipientFallback(recipientId);
      if (result) queued.set(result.campaignId, result);
    } catch (err) {
      logger.error({ err, recipientId }, '[mail-fallback] 대체 발송 등록 실패');
    }
  }
  for (const { campaignId, surveyId } of queued.values()) {
    try {
      await inngest.send({ name: 'mail/campaign.queued', data: { campaignId, surveyId } });
    } catch (err) {
      // 수신자는 queued 로 남는다 — 같은 대체 회차에 다음 수신자가 들어올 때 다시 깨운다.
      logger.error({ err, campaignId }, '[mail-fallback] 대체 발송 큐 등록 실패');
    }
  }
}

/** 대체 회차가 「멈췄다」고 볼 대기 시간 — 이보다 오래 손대지 않은 대기 수신자를 다시 깨운다. */
export const FALLBACK_STALL_MS = 2 * 60_000;

/**
 * 대기 수신자가 있는데 오래 아무도 집어 가지 않은 대체 회차 — 정기 점검(`mailFallbackSweeper`)이 다시 큐에 올린다.
 *
 * 대체 수신자를 커밋한 뒤 `mail/campaign.queued` 발행이 실패하면 그 수신자를 다시 깨울 사건이 없다 —
 * 같은 수신자로 다시 불려도 이미 있는 줄이라 그냥 끝나고, webhook 은 중복 제거로 다시 오지 않는다.
 * 이 점검이 그 구멍을 메운다(2026-10-16 리뷰). 회차의 updated_at 은 수신자를 넣거나(카운터) 발송이
 * 진행될 때(카운터) 갱신되므로, 오래 그대로인 queued 행은 아무도 처리하지 않는 것이다.
 * 발송 중인 회차에 다시 큐를 넣어도 안전하다 — 발송기는 전역 직렬이고 수신자 lease 가 중복 발송을 막는다.
 */
export async function listStalledFallbackCampaigns(now = new Date()): Promise<QueuedFallback[]> {
  const stalledBefore = new Date(now.getTime() - FALLBACK_STALL_MS);
  return db
    .select({ campaignId: mailCampaigns.id, surveyId: mailCampaigns.surveyId })
    .from(mailCampaigns)
    .where(
      and(
        eq(mailCampaigns.kind, 'fallback'),
        isNull(mailCampaigns.archivedAt),
        inArray(mailCampaigns.status, ['queued', 'sending']),
        lt(mailCampaigns.updatedAt, stalledBefore),
        sql`EXISTS (
          SELECT 1 FROM mail_recipients r
          WHERE r.campaign_id = ${mailCampaigns.id}
            AND r.status = 'queued'
            AND r.archived_at IS NULL
        )`,
      ),
    );
}

/** 처리 대기 표식을 다시 처리할 나이 상한 — 이보다 오래된 표식은 늦은 대체 발송이 되므로 건너뛴다. */
export const FALLBACK_PENDING_MAX_AGE_MS = 3 * 24 * 60 * 60_000;

/** 정기 점검 한 번에 다시 처리하는 수신자 수. */
const FALLBACK_PENDING_BATCH = 200;

/**
 * 대체 발송 처리 대기 표식이 오래 남은 수신자 — 즉시 경로(webhook·reconcile·dispatch 직후)가 DB 오류나
 * 프로세스 종료로 처리하지 못한 것이다. 표식은 반송·거부 전이와 같은 트랜잭션에서 찍히므로, 전이가
 * 커밋됐다면 처리 여부와 무관하게 여기서 다시 찾을 수 있다(2026-10-19 리뷰 — 전에는 webhook 중복 제거
 * 때문에 다시 시도할 길이 없었다). 즉시 경로와 겹치지 않게 FALLBACK_STALL_MS 를 기다린 표식만 본다.
 */
export async function listPendingFallbackRecipientIds(now = new Date()): Promise<string[]> {
  const stalledBefore = new Date(now.getTime() - FALLBACK_STALL_MS);
  const notOlderThan = new Date(now.getTime() - FALLBACK_PENDING_MAX_AGE_MS);
  const rows = await db
    .select({ id: mailRecipients.id })
    .from(mailRecipients)
    .where(
      and(
        lt(mailRecipients.fallbackPendingAt, stalledBefore),
        gte(mailRecipients.fallbackPendingAt, notOlderThan),
      ),
    )
    .orderBy(asc(mailRecipients.fallbackPendingAt))
    .limit(FALLBACK_PENDING_BATCH);
  return rows.map((r) => r.id);
}

/** 처리 대기 표식이 오래 남은 수신자의 대체 발송을 다시 건다 — 정기 점검(`mailFallbackSweeper`)이 부른다. */
export async function retryPendingRecipientFallbacks(now = new Date()): Promise<string[]> {
  const ids = await listPendingFallbackRecipientIds(now);
  if (ids.length === 0) return ids;
  logger.warn({ recipientIds: ids }, '[mail-fallback] 처리되지 않은 대체 발송을 다시 처리');
  await requestRecipientFallbacks(ids);
  return ids;
}
