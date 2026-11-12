import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { NextResponse, type NextRequest } from 'next/server';
import { Webhook } from 'svix';

import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import { forwardReceivedReply } from '@/server/mail/services/reply-forward';
import { processResendWebhookEvent } from '@/server/mail/services/resend-webhook';
import { isSentryCaptured } from '@/server/rpc-error-policy';

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
 *
 * 받은 메일 알림 (`email.received`):
 *   - 보낸 사람 주소로 들어온 메일이다. 수신자 상태 전이 경로를 타지 않고 회신 전달 서비스로 간다.
 *   - 알림에 실린 받는 주소·보낸 사람은 서비스에 넘긴다 — 조회 전에 넘기지 않을 메일을 거르는 데만 쓰인다.
 *     넘길 메일의 판정은 서비스가 받은 메일 id 로 직접 조회한 값으로 한다. 제목 같은 나머지는 넘기지 않고,
 *     로그·Sentry 에는 여전히 식별자만 싣는다.
 *   - 회사 도메인에서 서명이 맞는 중계 주소로 온 메일(담당자가 전달 메일에 한 답장)은 같은 서비스가 응답자에게 넘긴다(답장 중계).
 *     중계 주소의 서명 키는 이 라우트의 `RESEND_WEBHOOK_SECRET` 이다 — 바꾸면 이미 나간 전달 메일의 「답장」이 죽는다.
 *   - 넘기지 않은 메일도 200 이다. 조회·내려받기·발송 실패만 500 (장부에 적지 않아 재시도가 처음부터 다시 한다).
 *   - 시간당 상한 초과도 500 이다 — 재시도가 뒤로 미룬다. Sentry 경고는 서비스가 내고 여기서는 다시 보내지 않는다.
 */

/**
 * 실행 시간 제한(초). 상태 알림은 DB 트랜잭션 하나라 금방 끝나지만, 받은 메일 알림은 큰 첨부 한 통의
 * 조회(15초) → 원본 내려받기(60초) → 받은 그대로 발송(120초) → 첨부를 뺀 재발송(30초)까지 갈 수 있다 —
 * 단계별 제한 시간(`REPLY_FORWARD_STEP_TIMEOUTS_MS`)의 합 225초에 DB 조회·원본 풀기 몫을 더한 값이다.
 * 플랫폼 기본값에 기대지 않고 적어 둔다 — 기본값이 줄면 큰 첨부가 중간에 끊긴다.
 * Next 가 정적으로 읽는 값이라 상수를 import 하지 못한다. 대조는 `route-exports.test.ts` 가 한다.
 */
export const maxDuration = 300;

/** 보낸 사람 주소로 메일이 들어왔다는 알림. 이때 `data.email_id` 는 받은 메일의 id 다. */
const RECEIVED_EVENT_TYPE = 'email.received';

interface ResendEventPayload {
  type: string;
  created_at: string;
  data?: {
    email_id?: string;
    tags?: Record<string, string>;
    /** 받은 메일 알림(`email.received`)에만 실린다 — 보낸 사람 표기와 실제 수신 주소. */
    from?: unknown;
    received_for?: unknown;
    // 나머지 필드는 본 핸들러에서 미사용.
  };
}

/**
 * 받은 메일 알림에 실린 받는 주소·보낸 사람 — 회신 전달 서비스가 받은 메일을 조회하기 전에 넘기지 않을 메일을 거르는 재료다.
 * 모양이 다르면 넘기지 않는다(서비스가 조회 뒤에 판정한다). 로그·Sentry 에는 싣지 않는다.
 */
function receivedHints(data: ResendEventPayload['data']): { receivedFor?: string[]; from?: string } {
  const receivedFor = data?.received_for;
  const from = data?.from;
  return {
    ...(Array.isArray(receivedFor) && receivedFor.every((value) => typeof value === 'string')
      ? { receivedFor: receivedFor as string[] }
      : {}),
    ...(typeof from === 'string' ? { from } : {}),
  };
}

const POST_HANDLER = async (req: NextRequest, ctx: RouteLogContext): Promise<NextResponse> => {
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
  // 로그에는 식별자만 싣는다 — payload.data 통짜(수신자 email 포함) 금지.
  ctx.bind({
    svixId,
    eventType: payload.type,
    ...(messageId !== undefined ? { resendMessageId: messageId } : {}),
  });
  try {
    if (payload.type === RECEIVED_EVENT_TYPE && messageId !== undefined) {
      const forwarded = await forwardReceivedReply({
        eventId: svixId,
        receivedEmailId: messageId,
        ...receivedHints(payload.data),
      });
      return NextResponse.json({ ok: true, replyForward: forwarded.outcome });
    }
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
    ctx.log.error({ err }, 'resend webhook 처리 실패');
    // 서비스가 표식을 단 오류는 장애로 보내지 않는다 — 이미 경고로 보낸 것(회신 전달 시간당 상한 초과)과
    // 장애가 아닌 것(같은 알림이 처리 중)이다.
    if (!isSentryCaptured(err)) {
      Sentry.captureException(err, {
        tags: { operation: 'resend_webhook' },
        extra: { eventType: payload.type, messageId, svixId },
      });
    }
    // non-2xx로 provider retry를 요청한다. transaction rollback으로 dedupe row도 남지 않는다.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
};

export const POST = withRouteLogging('/api/webhooks/resend', POST_HANDLER, {
  source: 'resend-webhook',
});
