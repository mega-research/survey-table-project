import 'server-only';

import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import { webhookEvents } from '@/db/schema/mail';

import {
  REPLY_FORWARD_CAP_WINDOW_MS,
  REPLY_FORWARD_EVENT_TYPE,
  REPLY_FORWARD_HOURLY_CAP,
  REPLY_FORWARD_SLOT_EVENT_TYPE,
  REPLY_RELAY_DELIVERY_EVENT_TYPE,
  replyForwardSlotId,
  replyRelayDeliveryId,
  type ReplyForwardLedgerOutcome,
} from '../domain/reply-forward';

/**
 * 회신 전달의 웹훅 장부(`webhook_events`) 읽기·쓰기.
 *
 * 수신자 상태 알림(`resend-webhook`)은 장부 기록과 상태 전이를 한 트랜잭션으로 묶지만, 회신 전달은
 * 그 사이에 외부 호출(받은 메일 조회·원본 내려받기·발송)이 끼므로 **확인과 기록을 따로** 한다 —
 * 외부 호출 동안 DB 트랜잭션을 잡지 않는다. 그 틈은 발송 멱등 키가 덮는다.
 *
 * 한 알림이 장부에 남기는 줄: 발송 전에 잡는 **자리 줄**(시간당 상한이 센다, id 는 알림 id 에서 파생 — 나가는 메일마다 하나)과
 * 처리가 끝난 뒤의 **결과 줄**(id 는 알림 id, 「이미 처리한 알림」 판정에 쓴다). 한 받은 메일에서 여러 통이 나가는
 * 답장 중계는 통이 나갈 때마다 **발송 기록 줄**을 더 적는다(대상마다 하나 — 재시도가 이미 나간 대상을 건너뛰는 재료).
 * 장부에는 주소를 적지 않는다 — 대상은 주소에서 뽑은 조각(`relayTargetKey`)으로만 가리킨다.
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

/**
 * 답장 중계의 한 대상에게 메일이 나갔다고 적는다(발송 성공 또는 「이미 보냄」 직후).
 * 같은 알림을 동시에 처리한 다른 요청이 먼저 적었으면 아무 일도 하지 않는다.
 */
export async function recordRelayDelivery(eventId: string, target: string): Promise<void> {
  await db
    .insert(webhookEvents)
    .values({
      id: replyRelayDeliveryId(eventId, target),
      source: 'resend',
      eventType: REPLY_RELAY_DELIVERY_EVENT_TYPE,
    })
    .onConflictDoNothing();
}

/**
 * 이 알림의 대상들 가운데 이미 메일이 나간 대상 — 발송 기록 줄이 있는 것만 돌려준다.
 * 발송 멱등 키와 달리 만료가 없다: 하루가 지난 재시도도 이미 나간 대상을 알아본다.
 */
export async function loadDeliveredRelayTargets(
  eventId: string,
  targets: readonly string[],
): Promise<Set<string>> {
  if (targets.length === 0) return new Set();
  const idToTarget = new Map(targets.map((target) => [replyRelayDeliveryId(eventId, target), target]));
  const rows = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        inArray(webhookEvents.id, [...idToTarget.keys()]),
        eq(webhookEvents.eventType, REPLY_RELAY_DELIVERY_EVENT_TYPE),
      ),
    );
  return new Set(rows.flatMap((row) => idToTarget.get(row.id) ?? []));
}

/** 자리 잡기의 결과. 못 잡았으면 그때 한 시간 안에 잡혀 있던 자리 수를 함께 돌려준다(경고의 재료). */
export type ForwardSlotReservation = { reserved: true } | { reserved: false; slotsInWindow: number };

/**
 * 자리 잡기를 한 줄로 세우는 잠금 키. 트랜잭션 잠금(`pg_advisory_xact_lock`)이라 커밋과 함께 풀린다 —
 * 세션 잠금은 트랜잭션 풀러(pgBouncer) 뒤에서 다른 요청의 연결에 남는다.
 */
const SLOT_LOCK_KEY = sql`hashtext('reply-forward-slot')`;

/**
 * 시간당 상한의 자리 하나를 **발송 전에** 잡는다.
 *
 * 짧은 트랜잭션 하나에서 잠금으로 줄을 세우고, 최근 한 시간의 자리 수를 센 뒤, 상한 아래면 자리 줄을 넣는다.
 * 세기와 넣기가 한 덩어리라 동시에 몰린 요청이 서로를 보지 못해 상한을 넘기는 일이 없다.
 * 외부 호출(내려받기·발송)은 이 트랜잭션 밖이다 — 호출부가 자리를 잡은 뒤에 한다.
 *
 * - 자리는 나가는 메일마다 하나다. 한 받은 메일에서 여러 통이 나가면 `target`(대상 조각)을 넘겨 통마다 따로 잡는다.
 * - 같은 알림(같은 대상)의 재시도는 자기 자리를 다시 쓴다(한 시간 안의 자리면 세지도, 막히지도 않는다).
 * - 한 시간이 지난 자기 자리는 지금의 상한을 다시 보고 시각을 지금으로 옮긴다 — 늦은 재시도도 지금의 한 시간에 든다.
 * - 자리는 돌려주지 않는다. 발송이 실패해도 한 시간 동안 센다.
 *
 * 창의 기준 시각과 자리 줄의 시각은 둘 다 `now`(앱 서버 시계)다 — 한 시계로 재야 경계가 어긋나지 않는다.
 */
export async function reserveForwardSlot(
  eventId: string,
  options: { now?: Date; target?: string } = {},
): Promise<ForwardSlotReservation> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - REPLY_FORWARD_CAP_WINDOW_MS);
  const slotId = replyForwardSlotId(eventId, options.target);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SLOT_LOCK_KEY})`);

    const [own] = await tx
      .select({ receivedAt: webhookEvents.receivedAt })
      .from(webhookEvents)
      .where(eq(webhookEvents.id, slotId))
      .limit(1);
    if (own && own.receivedAt.getTime() >= since.getTime()) return { reserved: true };

    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.eventType, REPLY_FORWARD_SLOT_EVENT_TYPE),
          gte(webhookEvents.receivedAt, since),
        ),
      );
    const slotsInWindow = row?.count ?? 0;
    if (slotsInWindow >= REPLY_FORWARD_HOURLY_CAP) return { reserved: false, slotsInWindow };

    await tx
      .insert(webhookEvents)
      .values({
        id: slotId,
        source: 'resend',
        eventType: REPLY_FORWARD_SLOT_EVENT_TYPE,
        receivedAt: now,
      })
      .onConflictDoUpdate({ target: webhookEvents.id, set: { receivedAt: now } });
    return { reserved: true };
  });
}
