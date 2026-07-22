import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { NextResponse, type NextRequest } from 'next/server';
import { Webhook } from 'svix';

import { processResendWebhookEvent } from '@/lib/mail/resend-webhook';

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
    tags?: Record<string, string>;
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

  const messageId = payload.data?.email_id;
  try {
    const result = await processResendWebhookEvent({
      id: svixId,
      type: payload.type,
      createdAt: payload.created_at,
      ...(messageId !== undefined ? { resendMessageId: messageId } : {}),
      ...(payload.data?.tags !== undefined ? { tags: payload.data.tags } : {}),
    });
    if (result === 'deduped') {
      return NextResponse.json({ ok: true, deduped: true });
    }
    if (result === 'ignored') {
      return NextResponse.json({ ok: true, ignored: 'unsupported event' });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { operation: 'resend_webhook' },
      extra: { eventType: payload.type, messageId, svixId },
    });
    // non-2xx로 provider retry를 요청한다. transaction rollback으로 dedupe row도 남지 않는다.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
};

export { POST_HANDLER as POST };
