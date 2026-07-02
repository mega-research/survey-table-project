import 'server-only';

import { and, eq } from 'drizzle-orm';

import { completedResponse, notDeletedResponse, notTestResponse } from '@/data/response-filters';
import { db } from '@/db';
import { surveyResponses, surveys } from '@/db/schema/surveys';

import { buildQuotaStatus, type QuotaStatus, type QuotaSummary } from './quota-status';

/** 설문 쿼터 현황(셀별 + 요약). 쿼터 미설정이면 null. */
export async function getQuotaStatus(surveyId: string): Promise<QuotaStatus | null> {
  const surveyRow = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { quotaConfig: true },
  });
  const config = surveyRow?.quotaConfig ?? null;
  if (!config) return null;

  const rows = await db
    .select({ questionResponses: surveyResponses.questionResponses })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        completedResponse,
        notDeletedResponse,
        notTestResponse,
      ),
    );

  const answersList = rows.map((r) => (r.questionResponses ?? {}) as Record<string, unknown>);
  return buildQuotaStatus(config, answersList);
}

/** KPI 카드용 요약만. 미설정이면 null. */
export async function getQuotaSummary(surveyId: string): Promise<QuotaSummary | null> {
  const status = await getQuotaStatus(surveyId);
  return status?.summary ?? null;
}
