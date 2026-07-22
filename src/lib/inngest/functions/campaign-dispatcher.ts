import {
  dispatchCampaignChunk,
  prepareCampaignDispatch,
  terminalizeUnresolvedCampaignDispatch,
  type DispatchCleanupResult,
  type DispatchChunkResult,
} from '@/lib/mail/campaign-dispatch';

import { inngest, type MailCampaignQueuedData } from '../client';

const CHUNK_SIZE = 50;

interface DispatchCleanupStep {
  sendEvent: (
    id: string,
    event: {
      name: 'mail/campaign.dispatched';
      data: MailCampaignQueuedData;
    },
  ) => Promise<unknown>;
  sleep: (id: string, duration: '23h') => Promise<unknown>;
  sleepUntil: (id: string, until: Date) => Promise<unknown>;
  run: <T>(id: string, callback: () => Promise<T>) => Promise<T>;
}

/** 최종 retry 소진 뒤 webhook 복구 여유를 주고 남은 미확정 row를 종결한다. */
export async function cleanupAfterDispatchRetryExhaustion(
  campaignId: string,
  surveyId: string,
  step: DispatchCleanupStep,
  terminalize: (
    campaignId: string,
  ) => Promise<DispatchCleanupResult> = terminalizeUnresolvedCampaignDispatch,
): Promise<DispatchCleanupResult> {
  await step.sendEvent('emit-dispatched-after-failure', {
    name: 'mail/campaign.dispatched',
    data: { campaignId, surveyId },
  });
  await step.sleep('wait-resend-idempotency-window', '23h');
  let result = await step.run(
    'terminalize-unresolved-dispatch',
    () => terminalize(campaignId),
  );

  let leaseWait = 0;
  while (result.busyUntil !== null) {
    leaseWait += 1;
    const retryAt = new Date(new Date(result.busyUntil).getTime() + 1_000);
    await step.sleepUntil(`wait-active-delivery-lease-${leaseWait}`, retryAt);
    result = await step.run(
      `terminalize-after-active-lease-${leaseWait}`,
      () => terminalize(campaignId),
    );
  }
  return result;
}

export async function runCampaignChunks(
  recipientIds: string[],
  chunkSize: number,
  runChunk: (recipientIds: string[], chunkIndex: number) => Promise<DispatchChunkResult>,
): Promise<{ sent: number; failed: number; cancelled: boolean }> {
  const totals = { sent: 0, failed: 0, cancelled: false };
  for (let i = 0; i < recipientIds.length; i += chunkSize) {
    const slice = recipientIds.slice(i, i + chunkSize);
    const chunkIndex = Math.floor(i / chunkSize);
    const result = await runChunk(slice, chunkIndex);
    totals.sent += result.sent;
    totals.failed += result.failed;
    if (result.cancelled) {
      totals.cancelled = true;
      break;
    }
  }
  return totals;
}

/**
 * chunk가 inactive campaign을 만나 성공 취소로 끝나도 ambiguous sending을 방치하지 않는다.
 * 정상 완료는 즉시 reconcile만 예약하고, 취소 완료는 provider idempotency 창 뒤 cleanup한다.
 */
export async function finishCampaignDispatch(
  campaignId: string,
  surveyId: string,
  cancelled: boolean,
  step: DispatchCleanupStep,
  terminalize: (
    campaignId: string,
  ) => Promise<DispatchCleanupResult> = terminalizeUnresolvedCampaignDispatch,
): Promise<DispatchCleanupResult | null> {
  if (cancelled) {
    return cleanupAfterDispatchRetryExhaustion(
      campaignId,
      surveyId,
      step,
      terminalize,
    );
  }

  await step.sendEvent('emit-dispatched', {
    name: 'mail/campaign.dispatched',
    data: { campaignId, surveyId },
  });
  return null;
}

/**
 * 단체 메일 단체 메일 발송 dispatcher.
 *
 * 트리거: `mail/campaign.queued` (mail-campaigns.service 의 createCampaign 트랜잭션 끝에 emit)
 * concurrency: 모든 campaign dispatcher를 전역 직렬 처리.
 *   - Resend rate limit 안전 마진 (per-domain 10 req/s 기본)
 *   - 카운터 race condition 회피
 *   - 같은 설문 수신자가 동시간대 폭주 방지
 * retries: 2회. 일시 오류 (네트워크/Resend 5xx) 복구. recipient lease, 고정 payload
 * snapshot, recipient 기반 idempotency key로 재시도 중 중복 발송을 억제.
 *
 * Finalize 판정 (status='sending' → 'completed'/'partial')은 webhook handler 가 즉시 처리.
 * webhook 누락 시 pg_cron (0020 migration 가이드 주석) 이 일 1회 보강.
 */
export const campaignDispatcher = inngest.createFunction(
  {
    id: 'campaign-dispatcher',
    triggers: [{ event: 'mail/campaign.queued' }],
    concurrency: { limit: 1 },
    retries: 2,
    onFailure: async ({ event, step }) => {
      const data = event.data.event.data as MailCampaignQueuedData;
      await cleanupAfterDispatchRetryExhaustion(
        data.campaignId,
        data.surveyId,
        step as DispatchCleanupStep,
      );
    },
  },
  async ({ event, step, ...inngestCtx }) => {
    // inngest 4.x triggers-API 컨텍스트 타입에는 logger 가 노출되지 않지만,
    // 런타임에는 미들웨어가 ctx.logger 를 주입한다. console 과 호환되는 좁은 형태로 단언.
    const logger =
      (inngestCtx as { logger?: Pick<Console, 'info' | 'warn' | 'error' | 'debug'> })
        .logger ?? console;
    const data = event.data as MailCampaignQueuedData;
    const { campaignId } = data;

    const ctx = await step.run('prepare', () => prepareCampaignDispatch(campaignId));
    if (!ctx) {
      logger.info('campaign skipped (not found / cancelled / completed)', { campaignId });
      return { skipped: true, campaignId };
    }
    if (ctx.requiresCleanup) {
      const cleanup = await finishCampaignDispatch(
        campaignId,
        data.surveyId,
        true,
        step as DispatchCleanupStep,
      );
      logger.info('inactive campaign ambiguous dispatch cleanup completed', {
        campaignId,
        cleanup,
      });
      return { skipped: true, campaignId, cleanup };
    }
    if (ctx.recipientIds.length === 0) {
      logger.info('no queued recipients', { campaignId });
      return { ok: true, total: 0 };
    }

    const totals = await runCampaignChunks(
      ctx.recipientIds,
      CHUNK_SIZE,
      (slice, chunkIndex) => step.run(
        `send-chunk-${chunkIndex}`,
        () => dispatchCampaignChunk(campaignId, slice),
      ),
    );

    const cleanup = await finishCampaignDispatch(
      campaignId,
      data.surveyId,
      totals.cancelled,
      step as DispatchCleanupStep,
    );

    return {
      ok: true,
      total: ctx.recipientIds.length,
      ...totals,
      ...(cleanup !== null ? { cleanup } : {}),
    };
  },
);
