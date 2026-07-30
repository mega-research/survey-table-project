import {
  runDeletionExecutor,
  type DeletionExecutorStep,
} from '@/lib/r2-lifecycle/deletion-executor.server';

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

    const totals = await runDeletionExecutor(step as unknown as DeletionExecutorStep);

    logger.info('r2 deletion executor done', totals);
    return totals;
  },
);
