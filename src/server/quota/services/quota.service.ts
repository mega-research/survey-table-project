import { and, eq, isNull } from 'drizzle-orm';
import 'server-only';

import { notDeletedResponse } from '@/data/response-filters';
import { db } from '@/db';
import { surveyResponses, surveys } from '@/db/schema/surveys';
import { loadCompletedPlainAnswers } from '@/server/shared/completed-answers.server';
import { countCell, deriveCategoryIds, findTarget } from '@/lib/quota/matching';
import type { QuotaConfig } from '@/shared/contracts/quota';

/** 설문의 쿼터 플랜 조회. 미설정이면 null. */
export async function getQuotaConfig(surveyId: string): Promise<QuotaConfig | null> {
  const row = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { quotaConfig: true },
  });
  return row?.quotaConfig ?? null;
}

/** 설문의 쿼터 플랜 저장(덮어쓰기). 없는 설문이면 throw. */
export async function saveQuotaConfig(surveyId: string, config: QuotaConfig): Promise<QuotaConfig> {
  const [updated] = await db
    .update(surveys)
    .set({ quotaConfig: config, updatedAt: new Date() })
    .where(eq(surveys.id, surveyId))
    .returning({ quotaConfig: surveys.quotaConfig });

  if (!updated) throw new Error('쿼터 저장에 실패했습니다.');
  return updated.quotaConfig ?? config;
}

/**
 * 쿼터 마감 판정(집행). 미설정/미집행/미분류/미등록 셀/여유 → blocked:false.
 * 해당 셀 완료 수 ≥ target 이면 응답을 quotaful_out 으로 마킹하고 blocked:true.
 * 카운트는 완료 응답을 로드해 lib/quota 순수 함수로 센다(checkQuota·현황판 동일 소스).
 */
export async function checkQuota(input: {
  responseId: string;
  surveyId: string;
  answers: Record<string, unknown>;
}): Promise<{ blocked: boolean; closedMessage: string | null }> {
  const config = await getQuotaConfig(input.surveyId);
  if (!config || !config.enabled) return { blocked: false, closedMessage: null };

  // 응답 행 자체가 권위 소스다. 테스트 링크는 실제 quota를 소비하거나 quotaful_out으로
  // 전환되지 않으며, responseId와 surveyId가 섞인 pub mutation은 판정 전에 거부한다.
  const response = await db.query.surveyResponses.findFirst({
    where: and(
      eq(surveyResponses.id, input.responseId),
      eq(surveyResponses.surveyId, input.surveyId),
      notDeletedResponse,
    ),
    columns: { isTest: true },
  });
  if (!response) throw new Error('쿼터 응답 범위가 일치하지 않습니다.');
  if (response.isTest) return { blocked: false, closedMessage: null };

  const categoryIds = deriveCategoryIds(config, input.answers);
  if (!categoryIds) return { blocked: false, closedMessage: null };

  const target = findTarget(config, categoryIds);
  if (target === null) return { blocked: false, closedMessage: null };

  // 집행 모수는 언제나 실응답(real) — 테스트 파티션은 쿼터를 소비하지 않는다.
  const answersList = await loadCompletedPlainAnswers(input.surveyId, 'real');
  const current = countCell(config, categoryIds, answersList);

  if (current >= target) {
    await markQuotaFull(input.responseId, input.surveyId);
    return { blocked: true, closedMessage: config.closedMessage };
  }
  return { blocked: false, closedMessage: null };
}

/**
 * 응답을 quotaful_out 으로 마킹. 반드시 (id + surveyId) 로 스코프하고 in_progress·비삭제 행에만 적용.
 * surveyId 가드는 pub 호출자가 타 설문의 응답을 변조하는 것을 차단하고, in_progress 가드는 종결 상태 덮어쓰기를 막는다.
 */
export async function markQuotaFull(responseId: string, surveyId: string): Promise<void> {
  await db
    .update(surveyResponses)
    .set({ status: 'quotaful_out', lastActivityAt: new Date() })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        eq(surveyResponses.surveyId, surveyId),
        isNull(surveyResponses.deletedAt),
        eq(surveyResponses.status, 'in_progress'),
      ),
    );
}
