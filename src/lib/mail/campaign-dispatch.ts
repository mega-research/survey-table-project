import 'server-only';

import { createElement } from 'react';

import { render } from '@react-email/render';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { mailCampaigns, mailRecipients } from '@/db/schema/mail';
import { buildInviteUrl } from '@/lib/survey-url';
import { finalizeCampaignIfDone } from '@/lib/mail/recipient-status-transition';
import { renderForCampaignSend } from '@/lib/mail/render-for-send';
import {
  resolveCampaignAttachments,
  sendCampaignBatch,
  type BulkRecipientInput,
} from '@/lib/mail/send-bulk';
import { MailWrapper } from '@/lib/mail/template-wrapper';
import { UNSUBSCRIBE_SANDBOX_TOKEN } from '@/lib/mail/constants';

type CampaignDispatchState = Pick<
  typeof mailCampaigns.$inferSelect,
  'status' | 'archivedAt'
>;

export interface DispatchChunkResult {
  sent: number;
  failed: number;
  cancelled?: true;
}

function canDispatchCampaign(campaign: CampaignDispatchState): boolean {
  return campaign.archivedAt === null
    && (campaign.status === 'queued' || campaign.status === 'sending');
}

/**
 * Inngest dispatcher 의 'prepare' step.
 *   - campaign 검증 (queued/sending + non-archived만 허용)
 *   - status='sending' + started_at 마킹 (이미 sending 이면 변동 없음)
 *   - queued 상태인 recipient id 목록 반환 (각 chunk step 에서 inArray 로 다시 페치)
 *
 * Inngest step output 으로 직렬화되므로 recipientIds 만 반환 (Buffer 등 무거운 객체 X).
 */
export async function prepareCampaignDispatch(
  campaignId: string,
): Promise<{ recipientIds: string[] } | null> {
  const [campaign] = await db.select().from(mailCampaigns).where(eq(mailCampaigns.id, campaignId));
  if (!campaign) return null;
  if (!canDispatchCampaign(campaign)) return null;

  const activated = await db
    .update(mailCampaigns)
    .set({
      status: 'sending',
      startedAt: campaign.startedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailCampaigns.id, campaignId),
        isNull(mailCampaigns.archivedAt),
        or(eq(mailCampaigns.status, 'queued'), eq(mailCampaigns.status, 'sending')),
      ),
    )
    .returning({ id: mailCampaigns.id });
  if (activated.length === 0) return null;

  const queued = await db
    .select({ id: mailRecipients.id })
    .from(mailRecipients)
    .where(
      and(
        eq(mailRecipients.campaignId, campaignId),
        eq(mailRecipients.status, 'queued'),
        isNull(mailRecipients.archivedAt),
      ),
    );

  return { recipientIds: queued.map((r) => r.id) };
}

/**
 * Inngest dispatcher 의 'send-chunk' step. 청크 1개 처리:
 *   1. campaign + recipients + contact_targets 페치
 *   2. 첨부 R2 다운로드 (있으면 — 청크당 1회)
 *   3. recipient 별 html 빌드 (renderForCampaignSend → MailWrapper)
 *   4. campaign 재확인 + queued recipient를 sending으로 원자 인수
 *   5. 인수된 recipient만 sendCampaignBatch 호출
 *   6. 결과별 mail_recipients UPDATE + mail_campaigns 카운터 atomic delta
 */
export async function dispatchCampaignChunk(
  campaignId: string,
  recipientIds: string[],
): Promise<DispatchChunkResult> {
  const [campaign] = await db.select().from(mailCampaigns).where(eq(mailCampaigns.id, campaignId));
  if (!campaign || !canDispatchCampaign(campaign)) {
    return { sent: 0, failed: 0, cancelled: true };
  }

  const baseUrl = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('NEXT_PUBLIC_APP_URL 환경변수가 설정되지 않았습니다.');
  const fromDomain = process.env['RESEND_FROM_DOMAIN'];
  if (!fromDomain) throw new Error('RESEND_FROM_DOMAIN 환경변수가 설정되지 않았습니다.');

  // recipients + contact_targets join — queued 상태만 처리 (재실행/retry 시 이미 처리된 row 건너뜀).
  // 발송용 이메일은 mail_recipients.emailSnapshot 평문값을 그대로 사용 — campaign 생성 시점에
  // contact_pii cipher 복호화해 snapshot 으로 박아둔 값. 발송 시 재복호화 불필요.
  const rows = await db
    .select({
      recipientId: mailRecipients.id,
      emailSnapshot: mailRecipients.emailSnapshot,
      inviteCode: contactTargets.inviteCode,
      unsubscribeToken: contactTargets.unsubscribeToken,
      attrs: contactTargets.attrs,
      unsubscribedAt: contactTargets.unsubscribedAt,
    })
    .from(mailRecipients)
    .innerJoin(contactTargets, eq(mailRecipients.contactTargetId, contactTargets.id))
    .where(
      and(
        eq(mailRecipients.campaignId, campaignId),
        inArray(mailRecipients.id, recipientIds),
        eq(mailRecipients.status, 'queued'),
        isNull(mailRecipients.archivedAt),
      ),
    );

  if (rows.length === 0) return { sent: 0, failed: 0 };

  // 큐잉 → dispatch 사이에 수신거부한 수신자는 발송 대상에서 제외하고 skipped_unsubscribed
  // 로 마감한다(TOCTOU 차단, 정보통신망법 제50조 수신거부 즉시반영). queued_count 도 함께
  // 감소시켜 finalize 판정(queued_count=0)이 막히지 않게 한다.
  const activeRows = rows.filter((row) => row.unsubscribedAt == null);
  const unsubscribedRows = rows.filter((row) => row.unsubscribedAt != null);

  const skipNow = new Date();
  for (const row of unsubscribedRows) {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(mailRecipients)
        .set({ status: 'skipped_unsubscribed', updatedAt: skipNow })
        .where(
          and(eq(mailRecipients.id, row.recipientId), eq(mailRecipients.status, 'queued')),
        )
        .returning({ id: mailRecipients.id });
      if (updated.length === 0) return;
      await tx
        .update(mailCampaigns)
        .set({
          queuedCount: sql`${mailCampaigns.queuedCount} - 1`,
          skippedUnsubscribedCount: sql`${mailCampaigns.skippedUnsubscribedCount} + 1`,
          updatedAt: skipNow,
        })
        .where(eq(mailCampaigns.id, campaignId));
    });
  }

  type ActiveRow = (typeof activeRows)[number];
  const sendableRows = activeRows.filter(
    (row): row is ActiveRow & { emailSnapshot: string } => row.emailSnapshot !== null,
  );

  // 활성 수신자가 없으면(전건 수신거부 또는 비식별 snapshot) 발송 없이 종료 판정만 수행.
  if (sendableRows.length === 0) {
    await db.transaction((tx) => finalizeCampaignIfDone(tx, campaignId));
    return { sent: 0, failed: 0 };
  }

  const attachments =
    campaign.attachmentsSnapshot.length > 0
      ? await resolveCampaignAttachments(campaign.attachmentsSnapshot)
      : undefined;

  const from = `${campaign.fromNameSnapshot} <${campaign.fromLocalSnapshot}@${fromDomain}>`;
  const replyTo =
    campaign.replyToSnapshot ?? `${campaign.fromLocalSnapshot}@${fromDomain}`;

  const bulkInputs: BulkRecipientInput[] = await Promise.all(
    sendableRows.map(async (row) => {
      const inviteUrl = buildInviteUrl(row.inviteCode, baseUrl);
      const unsubscribeToken = campaign.isTest
        ? UNSUBSCRIBE_SANDBOX_TOKEN
        : row.unsubscribeToken;
      const unsubscribeUrl = `${baseUrl}/unsubscribe/${unsubscribeToken}`;

      const rendered = renderForCampaignSend({
        subject: campaign.subjectSnapshot,
        bodyHtml: campaign.bodyHtmlSnapshot,
        fromName: campaign.fromNameSnapshot,
        contactAttrs: row.attrs,
        contactEmail: row.emailSnapshot,
        inviteUrl,
      });

      const html = await render(
        createElement(MailWrapper, {
          bodyHtml: rendered.bodyHtml,
          previewText: rendered.subject,
          unsubscribeUrl,
          testFooterKind: campaign.isTest ? 'campaign' : null,
        }),
      );

      return {
        recipientId: row.recipientId,
        to: row.emailSnapshot,
        subject: rendered.subject,
        html,
      };
    }),
  );

  // campaign row의 SHARE lock이 future cancel/archive UPDATE와 직렬화된다. 이 transaction의
  // queued -> sending claim을 외부 발송 시작의 선형화 지점으로 삼고, 반환된 행만 보낸다.
  const claim = await db.transaction(async (tx) => {
    const [freshCampaign] = await tx
      .select({ status: mailCampaigns.status, archivedAt: mailCampaigns.archivedAt })
      .from(mailCampaigns)
      .where(eq(mailCampaigns.id, campaignId))
      .for('share');
    if (!freshCampaign || !canDispatchCampaign(freshCampaign)) {
      return { cancelled: true as const, recipientIds: [] as string[] };
    }

    const claimedAt = new Date();
    const claimed = await tx
      .update(mailRecipients)
      .set({ status: 'sending', updatedAt: claimedAt })
      .where(
        and(
          eq(mailRecipients.campaignId, campaignId),
          inArray(mailRecipients.id, sendableRows.map((row) => row.recipientId)),
          eq(mailRecipients.status, 'queued'),
          isNull(mailRecipients.archivedAt),
          isNotNull(mailRecipients.emailSnapshot),
        ),
      )
      .returning({ id: mailRecipients.id });

    return { cancelled: false as const, recipientIds: claimed.map((row) => row.id) };
  });

  if (claim.cancelled) return { sent: 0, failed: 0, cancelled: true };

  const claimedIds = new Set(claim.recipientIds);
  const claimedInputs = bulkInputs.filter((input) => claimedIds.has(input.recipientId));
  if (claimedInputs.length === 0) return { sent: 0, failed: 0 };

  const results = await sendCampaignBatch({
    from,
    replyTo,
    campaignId,
    ...(attachments !== undefined ? { attachments } : {}),
    recipients: claimedInputs,
  });

  let sent = 0;
  let failed = 0;
  const now = new Date();

  // 결과를 row 단위 트랜잭션으로 처리 — 카운터 atomic delta 보장.
  // status='sending' 가드로 race condition 방지 (이미 terminal인 row는 skip).
  for (const r of results) {
    if (r.resendMessageId) {
      const applied = await db.transaction(async (tx) => {
        const updated = await tx
          .update(mailRecipients)
          .set({
            status: 'sent',
            resendMessageId: r.resendMessageId,
            sentAt: now,
            updatedAt: now,
          })
          .where(
            and(eq(mailRecipients.id, r.recipientId), eq(mailRecipients.status, 'sending')),
          )
          .returning({ id: mailRecipients.id });
        if (updated.length === 0) return false;
        await tx
          .update(mailCampaigns)
          .set({
            queuedCount: sql`${mailCampaigns.queuedCount} - 1`,
            sentCount: sql`${mailCampaigns.sentCount} + 1`,
            updatedAt: now,
          })
          .where(eq(mailCampaigns.id, campaignId));
        return true;
      });
      if (applied) sent += 1;
    } else {
      const applied = await db.transaction(async (tx) => {
        const updated = await tx
          .update(mailRecipients)
          .set({
            status: 'failed',
            errorReason: r.errorReason ?? '알 수 없는 오류',
            updatedAt: now,
          })
          .where(
            and(eq(mailRecipients.id, r.recipientId), eq(mailRecipients.status, 'sending')),
          )
          .returning({ id: mailRecipients.id });
        if (updated.length === 0) return false;
        await tx
          .update(mailCampaigns)
          .set({
            queuedCount: sql`${mailCampaigns.queuedCount} - 1`,
            failedCount: sql`${mailCampaigns.failedCount} + 1`,
            updatedAt: now,
          })
          .where(eq(mailCampaigns.id, campaignId));
        return true;
      });
      if (applied) failed += 1;
    }
  }

  // 전건 failed(message_id 없음)로 끝나면 webhook이 도착하지 않아 finalize가 영영
  // 실행되지 않는다. 청크 처리 후 종료 조건(queued_count=0 AND sent_count=0)을 직접 판정해
  // 'sending'에 갇히는 것을 막는다. sent가 있으면 webhook이 finalize하므로 여기선 no-op.
  await db.transaction((tx) => finalizeCampaignIfDone(tx, campaignId));

  return { sent, failed };
}
