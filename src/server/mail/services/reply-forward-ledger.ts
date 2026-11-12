import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { webhookEvents } from '@/db/schema/mail';

import { REPLY_FORWARD_EVENT_TYPE, type ReplyForwardLedgerOutcome } from '../domain/reply-forward';

/**
 * 회신 전달의 웹훅 장부(`webhook_events`) 읽기·쓰기.
 *
 * 수신자 상태 알림(`resend-webhook`)은 장부 기록과 상태 전이를 한 트랜잭션으로 묶지만, 회신 전달은
 * 그 사이에 외부 호출(받은 메일 조회·원본 내려받기·발송)이 끼므로 **확인과 기록을 따로** 한다 —
 * 외부 호출 동안 DB 트랜잭션을 잡지 않는다. 그 틈은 발송 멱등 키가 덮는다.
 */

/** 이 알림(svix-id)이 이미 장부에 있는가 — 있으면 다시 처리하지 않는다. */
export async function isWebhookEventRecorded(eventId: string): Promise<boolean> {
  const rows = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, eventId))
    .limit(1);
  return rows.length > 0;
}

/**
 * 처리가 끝난 알림을 장부에 적는다. 이벤트 종류 칸에 결과(넘김 / 넘기지 않음)를 갈라 적는다.
 * 같은 알림을 동시에 처리한 다른 요청이 먼저 적었으면 아무 일도 하지 않는다.
 */
export async function recordReplyForwardEvent(
  eventId: string,
  outcome: ReplyForwardLedgerOutcome,
): Promise<void> {
  await db
    .insert(webhookEvents)
    .values({ id: eventId, source: 'resend', eventType: REPLY_FORWARD_EVENT_TYPE[outcome] })
    .onConflictDoNothing();
}
