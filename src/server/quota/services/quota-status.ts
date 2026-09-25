import { and, eq, isNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import { loadCompletedQuotaSubjects } from '@/server/read-models/completed-answers';

import type { OperationsDataScope } from '@/server/data-scope';
import { type QuotaStatus, type QuotaSummary, buildQuotaStatus } from '@/lib/quota/quota-status-calc';
import { needsContactAttrs } from '@/lib/quota/matching';
import { normalizeQuotaConfig } from '@/lib/quota/normalize';

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
    where: and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)),
    columns: { quotaConfig: true },
  });
  const config = normalizeQuotaConfig(surveyRow?.quotaConfig ?? null);
  if (!config) return null;

  const subjects = await loadCompletedQuotaSubjects(surveyId, scope, {
    withAttrs: needsContactAttrs(config),
  });
  return buildQuotaStatus(config, subjects);
}

/** KPI 카드용 요약만. 미설정이면 null. */
export async function getQuotaSummary(
  surveyId: string,
  scope: OperationsDataScope = 'real',
): Promise<QuotaSummary | null> {
  const status = await getQuotaStatus(surveyId, scope);
  return status?.summary ?? null;
}
