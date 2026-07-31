import * as Sentry from '@sentry/nextjs';

import { runDeletionExecutor } from '@/lib/r2-lifecycle/deletion-executor.server';
import { rebuildMutableKeyRefs } from '@/lib/r2-lifecycle/key-ref-index.server';

import { inngest } from '../client';

/**
 * R2 유예 삭제 집행 cron — 일 1회 (KST 04:00).
 *
 * 기한(등록+7일)이 지난 '대기' 후보를 배치로 집행한다: 발송 장부 히트·전역
 * 참조 재확인 히트는 '보존됨', 통과 키만 R2 삭제 + HEAD 검증 후 '삭제됨',
 * 오류는 '실패'로 남아 다음 집행에서 자동 재시도. 상세는
 * lib/r2-lifecycle/deletion-executor.server.ts.
 *
 * 운영: 레포 최초의 Inngest cron — 배포 후 Inngest 대시보드 수동 Resync 필수
 * (누락 시 조용히 미실행), icn1 리전 상호작용 확인. (.scratch/r2-안전-삭제/
 * deploy-checklist.md)
 */
export const r2DeletionExecutor = inngest.createFunction(
  { id: 'r2-deletion-executor', triggers: [{ cron: 'TZ=Asia/Seoul 0 4 * * *' }], retries: 2 },
  async ({ step, ...inngestCtx }) => {
    // inngest 4.x 컨텍스트 타입에는 logger 가 노출되지 않지만 런타임에는
    // 미들웨어가 주입한다 — campaign-reconciler 와 동일 관례.
    const logger =
      (inngestCtx as { logger?: Pick<Console, 'info' | 'warn' | 'error' | 'debug'> })
        .logger ?? console;

    // 집행 직전 가변 소스 인덱스를 재구축한다. 실패해도 집행을 막지 않는다 —
    // 인덱스는 사전 필터일 뿐이고 최종 판정은 콘텐츠 스캔이라 stale 해도
    // 과보존 방향으로만 작용한다 (spec 6.3).
    const rebuilt = await step.run('rebuild-mutable-key-refs', async () => {
      try {
        return await rebuildMutableKeyRefs();
      } catch (error) {
        console.error('r2 참조 인덱스 리빌드 실패 — stale 인덱스로 집행 진행:', error);
        Sentry.captureException(error, {
          tags: { operation: 'r2_key_ref_rebuild' },
          level: 'warning',
        });
        return [];
      }
    });
    logger.info('r2 key ref rebuild done', { sources: rebuilt });

    const totals = await runDeletionExecutor(step);

    logger.info('r2 deletion executor done', totals);
    return totals;
  },
);
