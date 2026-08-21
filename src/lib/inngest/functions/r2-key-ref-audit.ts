import * as Sentry from '@sentry/nextjs';

import { rebuildAllKeyRefs } from '@/server/shared/r2-lifecycle/key-ref-index.server';

import { ctxLogger, inngest } from '../client';

/**
 * R2 참조 인덱스 전량 감사 cron — 월 1회 (KST 매월 1일 03:00).
 *
 * 불변 소스를 포함한 전 소스를 재추출해 인덱스를 통째로 재생성한다.
 * 콘텐츠가 여전히 진실이므로 언제든 재생성할 수 있다는 성질을 이용한
 * 정합성 회복 장치다 (2026-07-31 spec 6.5).
 *
 * 인덱스 최초 채우기도 이 함수가 담당한다 — 배포 후 대시보드에서 1회 수동
 * 실행하면 전 소스가 채워진다.
 *
 * 운영: Inngest 자동 sync 가 끊겨 있어 배포 후 대시보드 수동 Resync 필수.
 */
const FUNCTION_ID = 'r2-key-ref-audit';

export const r2KeyRefAudit = inngest.createFunction(
  { id: FUNCTION_ID, triggers: [{ cron: 'TZ=Asia/Seoul 0 3 1 * *' }], retries: 2 },
  async (ctx) => {
    const { step } = ctx;
    const logger = ctxLogger(ctx);

    const results = await step.run('rebuild-all-key-refs', async () => {
      try {
        return await rebuildAllKeyRefs();
      } catch (error) {
        Sentry.captureException(error, {
          tags: { operation: 'r2_key_ref_audit' },
          level: 'warning',
        });
        throw error;
      }
    });

    logger.info({ functionId: FUNCTION_ID, sources: results }, 'R2 참조 인덱스 전량 감사 완료');
    return { sources: results };
  },
);
