import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { eq, sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { Webhook } from 'svix';

import { db } from '@/db';
import { mailCampaigns, mailRecipients, webhookEvents } from '@/db/schema/mail';
import type { MailRecipientStatus } from '@/db/schema/mail';

/**
 * Resend webhook handler.
 *
 * 단계:
 *   1. svix 헤더 검증 (signature)
 *   2. svix-id 기반 dedupe (webhook_events PK insert)
 *   3. 이벤트별 status 전이 + mail_campaigns 카운터 atomic delta + 즉시 finalize 판정
 *
 * 멱등성:
 *   - svix-id 가 PK 라 동일 이벤트 재전송은 ON CONFLICT 로 skip.
 *   - 추가로 status 역행 가드 (이미 더 진전된 상태면 무변동).
 *
 * Finalize (status='sending' → 'completed'/'partial'):
 *   - 같은 트랜잭션에서 carrier UPDATE 다음에 한 번 더 UPDATE. queued+sent=0 도달 시 즉시 마킹.
 *   - opened 는 사후에도 계속 도착 가능하지만 status 변동은 없음 (opened_count 만 누증).
 */

interface ResendEventPayload {
  type: string;
  created_at: string;
  data?: {
    email_id?: string;
    // 나머지 필드는 본 핸들러에서 미사용.
  };
}

const POST_HANDLER = async (req: NextRequest): Promise<NextResponse> => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    Sentry.captureMessage('RESEND_WEBHOOK_SECRET 환경변수 미설정', 'error');
    return NextResponse.json({ error: 'webhook misconfigured' }, { status: 500 });
  }

  const rawBody = await req.text();
  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'missing svix headers' }, { status: 400 });
  }

  let payload: ResendEventPayload;
  try {
    const wh = new Webhook(secret);
    payload = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendEventPayload;
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  // Idempotency: 동일 svix-id 재전송 차단
  const inserted = await db
    .insert(webhookEvents)
    .values({ id: svixId, source: 'resend', eventType: payload.type })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted.length === 0) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const messageId = payload.data?.email_id;
  if (!messageId) {
    return NextResponse.json({ ok: true, ignored: 'no email_id' });
  }

  try {
    await processResendEvent(messageId, payload.type, payload.created_at);
    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { operation: 'resend_webhook' },
      extra: { eventType: payload.type, messageId, svixId },
    });
    // 200 이외 응답하면 Resend 가 retry — 비결정적 에러는 위에서 dedupe 되니, 200 으로 응답하고 Sentry 만.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
};

export { POST_HANDLER as POST };

interface TransitionConfig {
  newStatus: MailRecipientStatus;
  allowedPrev: MailRecipientStatus[];
}

const TRANSITION_MAP: Record<string, TransitionConfig> = {
  'email.sent': { newStatus: 'sent', allowedPrev: ['queued'] },
  'email.delivered': { newStatus: 'delivered', allowedPrev: ['queued', 'sent'] },
  'email.opened': { newStatus: 'opened', allowedPrev: ['queued', 'sent', 'delivered'] },
  'email.bounced': {
    newStatus: 'bounced',
    allowedPrev: ['queued', 'sent', 'delivered', 'opened'],
  },
  'email.complained': {
    newStatus: 'complained',
    allowedPrev: ['queued', 'sent', 'delivered', 'opened'],
  },
  // email.delivery_delayed 는 status 변동 없음 — TRANSITION_MAP 에 없으면 skip.
};

async function processResendEvent(
  resendMessageId: string,
  eventType: string,
  createdAtRaw: string,
): Promise<void> {
  const config = TRANSITION_MAP[eventType];
  if (!config) return; // 무시 (delivery_delayed 등)

  const eventAt = new Date(createdAtRaw);
  if (Number.isNaN(eventAt.getTime())) {
    // payload 의 created_at 이 비정상 — 현재 시각 fallback
    eventAt.setTime(Date.now());
  }

  await db.transaction(async (tx) => {
    // FOR UPDATE 로 row 잠금 — 같은 svix-id 가 한 번만 처리되더라도, 다른 이벤트가
    // 같은 recipient 에 동시에 들어올 때 status 전이 race 방지.
    const rows = await tx
      .select({
        id: mailRecipients.id,
        campaignId: mailRecipients.campaignId,
        status: mailRecipients.status,
      })
      .from(mailRecipients)
      .where(eq(mailRecipients.resendMessageId, resendMessageId))
      .for('update');
    const row = rows[0];
    if (!row) return; // 외부 발송 또는 매칭 누락 — skip

    const prevStatus = row.status as MailRecipientStatus;
    if (!config.allowedPrev.includes(prevStatus)) return; // 역행/이미 처리됨

    const timestampUpdate = buildTimestampUpdate(config.newStatus, eventAt);
    await tx
      .update(mailRecipients)
      .set({
        status: config.newStatus,
        ...timestampUpdate,
        updatedAt: new Date(),
      })
      .where(eq(mailRecipients.id, row.id));

    // 카운터 atomic delta — 한 번의 UPDATE 로 prev/new 컬럼 동시 처리.
    // CASE WHEN 안의 ${} 는 drizzle sql 템플릿이 자동 parameterize.
    await tx.execute(sql`
      UPDATE mail_campaigns
      SET
        queued_count    = queued_count    - CASE WHEN ${prevStatus} = 'queued'    THEN 1 ELSE 0 END,
        sent_count      = sent_count      - CASE WHEN ${prevStatus} = 'sent'      THEN 1 ELSE 0 END
                                          + CASE WHEN ${config.newStatus} = 'sent'      THEN 1 ELSE 0 END,
        delivered_count = delivered_count - CASE WHEN ${prevStatus} = 'delivered' THEN 1 ELSE 0 END
                                          + CASE WHEN ${config.newStatus} = 'delivered' THEN 1 ELSE 0 END,
        opened_count    = opened_count    + CASE WHEN ${config.newStatus} = 'opened'    THEN 1 ELSE 0 END,
        bounced_count   = bounced_count   + CASE WHEN ${config.newStatus} = 'bounced'   THEN 1 ELSE 0 END,
        complained_count = complained_count + CASE WHEN ${config.newStatus} = 'complained' THEN 1 ELSE 0 END,
        updated_at = now()
      WHERE id = ${row.campaignId}
    `);

    // 즉시 finalize 마킹 — queued + sent 모두 0 도달 시.
    // delivered/opened/bounced/complained 는 terminal 또는 사후 누증 OK.
    await tx.execute(sql`
      UPDATE mail_campaigns
      SET status = CASE
              WHEN bounced_count + failed_count + complained_count > 0 THEN 'partial'
              ELSE 'completed'
            END,
          completed_at = COALESCE(completed_at, now()),
          updated_at = now()
      WHERE id = ${row.campaignId}
        AND status = 'sending'
        AND queued_count = 0
        AND sent_count = 0
    `);
  });
}

function buildTimestampUpdate(
  status: MailRecipientStatus,
  at: Date,
): Partial<typeof mailRecipients.$inferInsert> {
  switch (status) {
    case 'sent':
      return { sentAt: at };
    case 'delivered':
      return { deliveredAt: at };
    case 'opened':
      return { openedAt: at };
    case 'bounced':
      return { bouncedAt: at };
    case 'complained':
      return { complainedAt: at };
    default:
      return {};
  }
}
