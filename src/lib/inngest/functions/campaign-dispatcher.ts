import { dispatchCampaignChunk, prepareCampaignDispatch } from '@/lib/mail/campaign-dispatch';

import { inngest, type MailCampaignQueuedData } from '../client';

const CHUNK_SIZE = 50;

/**
 * 단체 메일 단체 메일 발송 dispatcher.
 *
 * 트리거: `mail/campaign.queued` (mail-campaigns.service 의 createCampaign 트랜잭션 끝에 emit)
 * concurrency: 같은 surveyId 단체 메일은 직렬 처리.
 *   - Resend rate limit 안전 마진 (per-domain 10 req/s 기본)
 *   - 카운터 race condition 회피
 *   - 같은 설문 수신자가 동시간대 폭주 방지
 * retries: 2회. 일시 오류 (네트워크/Resend 5xx) 복구. status='queued' 가드로 멱등.
 *
 * Finalize 판정 (status='sending' → 'completed'/'partial')은 webhook handler 가 즉시 처리.
 * webhook 누락 시 pg_cron (0020 migration 가이드 주석) 이 일 1회 보강.
 */
export const campaignDispatcher = inngest.createFunction(
  {
    id: 'campaign-dispatcher',
    triggers: [{ event: 'mail/campaign.queued' }],
    concurrency: { key: 'event.data.surveyId', limit: 1 },
    retries: 2,
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
    if (ctx.recipientIds.length === 0) {
      logger.info('no queued recipients', { campaignId });
      return { ok: true, total: 0 };
    }

    const totals = { sent: 0, failed: 0 };
    for (let i = 0; i < ctx.recipientIds.length; i += CHUNK_SIZE) {
      const slice = ctx.recipientIds.slice(i, i + CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CHUNK_SIZE);
      const result = await step.run(`send-chunk-${chunkIndex}`, () =>
        dispatchCampaignChunk(campaignId, slice),
      );
      totals.sent += result.sent;
      totals.failed += result.failed;
    }

    await step.sendEvent('emit-dispatched', {
      name: 'mail/campaign.dispatched',
      data: { campaignId, surveyId: data.surveyId },
    });

    return { ok: true, total: ctx.recipientIds.length, ...totals };
  },
);
