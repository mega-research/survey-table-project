import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { Webhook } from 'svix';

import { db } from '@/db';
import { mailRecipients, webhookEvents } from '@/db/schema/mail';
import type { MailRecipientStatus } from '@/db/schema/mail';
import { applyRecipientTransition, mapResendWebhookType } from '@/lib/mail/recipient-status-transition';

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
  const secret = process.env['RESEND_WEBHOOK_SECRET'];
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

async function processResendEvent(
  resendMessageId: string,
  eventType: string,
  createdAtRaw: string,
): Promise<void> {
  const newStatus = mapResendWebhookType(eventType);
  if (!newStatus) return; // delivery_delayed 등 무시

  const eventAt = new Date(createdAtRaw);
  if (Number.isNaN(eventAt.getTime())) eventAt.setTime(Date.now());

  await db.transaction(async (tx) => {
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
    if (!row) return; // 외부 발송 또는 race window(아직 message_id 미커밋) — reconcile 이 보강

    await applyRecipientTransition(tx, {
      recipientId: row.id,
      campaignId: row.campaignId,
      prevStatus: row.status as MailRecipientStatus,
      newStatus,
      eventAt,
    });
  });
}
