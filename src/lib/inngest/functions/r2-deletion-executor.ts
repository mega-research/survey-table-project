import * as Sentry from '@sentry/nextjs';

import { logger as baseLogger } from '@/lib/logger';

import { runDeletionExecutor } from '@/server/shared/r2-lifecycle/deletion-executor.server';
import { rebuildMutableKeyRefs } from '@/server/shared/r2-lifecycle/key-ref-index.server';

import { ctxLogger, inngest } from '../client';

/**
 * R2 유예 삭제 집행 cron — 일 1회 (KST 04:00).
 *
 * 기한(등록+7일)이 지난 '대기' 후보를 배치로 집행한다: 발송 장부 히트·참조
 * 인덱스 히트·전역 참조 재확인 히트는 '보존됨', 통과 키만 R2 삭제 + HEAD
 * 검증 후 '삭제됨', 오류는 '실패'로 남아 다음 집행에서 자동 재시도. 상세는
 * server/shared/r2-lifecycle/deletion-executor.server.ts.
 *
 * 운영: 레포 최초의 Inngest cron — 배포 후 Inngest 대시보드 수동 Resync 필수
 * (누락 시 조용히 미실행), icn1 리전 상호작용 확인. (.scratch/r2-안전-삭제/
 * deploy-checklist.md)
 */
const FUNCTION_ID = 'r2-deletion-executor';

export const r2DeletionExecutor = inngest.createFunction(
  { id: FUNCTION_ID, triggers: [{ cron: 'TZ=Asia/Seoul 0 4 * * *' }], retries: 2 },
  async (ctx) => {
    const { step } = ctx;
    // ctx.logger — 클라이언트 logger 옵션(pino child, source:'inngest')을 내장
    // 미들웨어가 runID child 로 감싼 것 (client.ts 주석 참조). totals 는 건수뿐이라 통짜 바인딩 허용.
    const logger = ctxLogger(ctx);

    // 집행 직전 가변 소스 인덱스를 재구축한다. 실패해도 집행을 막지 않는다 —
    // 인덱스는 사전 필터일 뿐이고 최종 판정은 콘텐츠 스캔이라 stale 해도
    // 과보존 방향으로만 작용한다 (spec 6.3).
    //
    // rebuildMutableKeyRefs 는 소스를 순차 순회하다 첫 실패에서 던지므로,
    // 실패한 소스 이후는 그날 아예 갱신되지 않는다. 원인이 결정적이면(예:
    // 행 전체를 Node 메모리로 올리는 rebuildSource 의 메모리 초과) 매일
    // 반복돼 stale 인덱스가 후보를 '보존됨'으로 영구 종결시킬 수 있다.
    // 그래서 실패 여부를 executor 에 명시적으로 전달해 이번 run 은 인덱스
    // 조회를 건너뛰고 스캔에만 맡긴다 — 스캔이 유일한 삭제 권한이므로
    // 정확도 손실 없이 스캔량만 늘어난다.
    const rebuildOutcome = await step.run('rebuild-mutable-key-refs', async () => {
      try {
        const rebuilt = await rebuildMutableKeyRefs();
        return { rebuilt, indexUnusable: false };
      } catch (error) {
        baseLogger.error({ err: error }, 'r2 참조 인덱스 리빌드 실패 — 이번 run 은 인덱스 없이 전량 스캔으로 진행');
        Sentry.captureException(error, {
          tags: { operation: 'r2_key_ref_rebuild' },
          level: 'warning',
        });
        return { rebuilt: [], indexUnusable: true };
      }
    });
    logger.info(
      {
        functionId: FUNCTION_ID,
        sources: rebuildOutcome.rebuilt,
        indexUnusable: rebuildOutcome.indexUnusable,
      },
      'R2 참조 인덱스 리빌드 완료',
    );

    const totals = await runDeletionExecutor(step, {
      indexUnusable: rebuildOutcome.indexUnusable,
    });

    logger.info({ functionId: FUNCTION_ID, ...totals }, 'R2 유예 삭제 집행 완료');
    return totals;
  },
);
