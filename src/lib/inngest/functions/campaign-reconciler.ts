import { reconcileCampaignRecipients } from '@/lib/mail/campaign-reconcile';

import { inngest, type MailCampaignDispatchedData } from '../client';

/**
 * 발송 직후 recipient 상태 reconcile.
 *
 * 트리거: `mail/campaign.dispatched` (campaign-dispatcher 가 청크 완료 후 emit)
 * 목적: race window(message_id 커밋 전 도착)로 유실된 webhook 을 Resend API 로 보강.
 * 추적 범위: 발송 후 1m / 5m / 30m 3회. 이후는 '알 수 없음'으로 남김.
 *
 * dispatcher 와 분리한 이유: step.sleep 이 dispatcher 의 function-global concurrency=1
 * 슬롯을 30분 점유해 모든 캠페인의 다음 발송을 막는 것을 회피.
 */
export const campaignReconciler = inngest.createFunction(
  { id: 'campaign-reconciler', triggers: [{ event: 'mail/campaign.dispatched' }], retries: 2 },
  async ({ event, step, ...inngestCtx }) => {
    // inngest 4.x triggers-API 컨텍스트 타입에는 logger 가 노출되지 않지만,
    // 런타임에는 미들웨어가 ctx.logger 를 주입한다. console 과 호환되는 좁은 형태로 단언.
    const logger =
      (inngestCtx as { logger?: Pick<Console, 'info' | 'warn' | 'error' | 'debug'> })
        .logger ?? console;
    const { campaignId } = event.data as MailCampaignDispatchedData;

    await step.sleep('wait-1m', '1m');
    const r1 = await step.run('reconcile-1', () => reconcileCampaignRecipients(campaignId));

    await step.sleep('wait-4m', '4m'); // 누적 5분
    const r2 = await step.run('reconcile-2', () => reconcileCampaignRecipients(campaignId));

    await step.sleep('wait-25m', '25m'); // 누적 30분
    const r3 = await step.run('reconcile-3', () => reconcileCampaignRecipients(campaignId));

    logger.info('campaign reconcile done', { campaignId, r1, r2, r3 });
    return { campaignId, rounds: [r1, r2, r3] };
  },
);
