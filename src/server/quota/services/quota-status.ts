import { eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import { loadCompletedQuotaSubjects } from '@/server/read-models/completed-answers';

import type { OperationsDataScope } from '@/server/data-scope';
import { type QuotaStatus, type QuotaSummary, buildQuotaStatus } from '@/lib/quota/quota-status-calc';
import { needsContactAttrs } from '@/lib/quota/matching';
import { normalizeQuotaConfig, quotaTotalTarget } from '@/lib/quota/normalize';
import { countQuotaTotalCompleted } from '@/server/read-models/quota-cell';

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
  const config = normalizeQuotaConfig(surveyRow?.quotaConfig ?? null);
  if (!config) return null;

  const [subjects, totalCompleted] = await Promise.all([
    loadCompletedQuotaSubjects(surveyId, scope, { withAttrs: needsContactAttrs(config) }),
    // 「완료」 조건이 있을 때만 센다 — 집행 판정(checkQuota·제출 하드 차단)과 같은 셈.
    quotaTotalTarget(config) !== null ? countQuotaTotalCompleted(db, surveyId, scope) : 0,
  ]);
  return buildQuotaStatus(config, subjects, totalCompleted);
}

/** KPI 카드용 요약만. 미설정이면 null. */
export async function getQuotaSummary(
  surveyId: string,
  scope: OperationsDataScope = 'real',
): Promise<QuotaSummary | null> {
  const status = await getQuotaStatus(surveyId, scope);
  return status?.summary ?? null;
}
