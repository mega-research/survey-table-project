import { eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import { loadCompletedPlainAnswers } from '@/server/shared/completed-answers.server';

import type { OperationsDataScope } from '@/server/shared/data-scope.server';
import { type QuotaStatus, type QuotaSummary, buildQuotaStatus } from '@/lib/operations/quota-status';

/**
 * 설문 쿼터 현황(셀별 + 요약). 쿼터 미설정이면 null.
 * scope='test' 면 테스트 응답 기준으로 집계한다 — 표시 전용이며, 실제 마감 집행(checkQuota)은
 * 언제나 실응답만 대상으로 한다.
 */
export async function getQuotaStatus(
  surveyId: string,
  scope: OperationsDataScope = 'real',
): Promise<QuotaStatus | null> {
  const surveyRow = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { quotaConfig: true },
  });
  const config = surveyRow?.quotaConfig ?? null;
  if (!config) return null;

  const answersList = await loadCompletedPlainAnswers(surveyId, scope);
  return buildQuotaStatus(config, answersList);
}

/** KPI 카드용 요약만. 미설정이면 null. */
export async function getQuotaSummary(
  surveyId: string,
  scope: OperationsDataScope = 'real',
): Promise<QuotaSummary | null> {
  const status = await getQuotaStatus(surveyId, scope);
  return status?.summary ?? null;
}
