import { listStalledFallbackCampaigns } from '@/server/mail/services/campaign-fallback';

import { ctxLogger, inngest } from '@/lib/inngest/client';

/**
 * 메일 대체 발송 정기 점검 — 10분마다 (KST).
 *
 * 대체 발송(실패·반송 뒤 다음 순위 이메일로 자동 재발송)은 대체 수신자를 DB 에 넣은 뒤
 * `mail/campaign.queued` 를 따로 낸다. 그 발행이 실패하면 수신자가 queued 로 영영 남는다 —
 * 다시 깨울 사건(webhook 재전송·다음 반송)이 오지 않을 수 있기 때문이다. 이 점검이 대기 수신자가
 * 있는데 오래 손대지 않은 대체 회차를 찾아 다시 큐에 올린다. 중복으로 올려도 발송기가 전역 직렬이고
 * 수신자 lease 가 막아 두 번 보내지 않는다.
 *
 * 운영: Inngest 자동 sync 가 끊겨 있어 배포 후 대시보드 수동 Resync 필수.
 */
const FUNCTION_ID = 'mail-fallback-sweeper';

export const mailFallbackSweeper = inngest.createFunction(
  { id: FUNCTION_ID, triggers: [{ cron: 'TZ=Asia/Seoul */10 * * * *' }], retries: 2 },
  async (ctx) => {
    const { step } = ctx;
    const logger = ctxLogger(ctx);

    const stalled = await step.run('list-stalled-fallback-campaigns', () =>
      listStalledFallbackCampaigns(),
    );
    if (stalled.length === 0) return { requeued: 0 };

    await step.sendEvent(
      'requeue-stalled-fallback-campaigns',
      stalled.map(({ campaignId, surveyId }) => ({
        name: 'mail/campaign.queued',
        data: { campaignId, surveyId },
      })),
    );
    logger.info(
      { functionId: FUNCTION_ID, campaignIds: stalled.map((c) => c.campaignId) },
      '멈춘 대체 발송 회차를 다시 큐에 올림',
    );
    return { requeued: stalled.length };
  },
);
