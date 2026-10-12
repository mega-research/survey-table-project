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

/**
 * 이 설문에 보여 줄 쿼터가 있는가 — 셀이 하나라도 있는 플랜.
 *
 * 링크 콘솔의 셸이 「쿼터 현황」 탭을 그릴지 정하는 데 쓴다. 현황(`getQuotaStatus`)을 부르지
 * 않는 이유는 그쪽이 완료 응답 전체를 읽어 세기 때문이다 — 셸은 모든 화면 이동에서 도는
 * 자리라 탭 하나를 위해 그 비용을 질 수 없다. 여기는 설문 행의 플랜만 읽는다.
 *
 * **현황 화면의 빈 상태 판정과 같은 술어여야 한다**(플랜이 있고 셀이 하나 이상). 갈리면
 * 「탭은 있는데 누르면 빈 안내」가 되고, 그것을 없애려던 것이 이 함수다.
 */
export async function hasQuotaPlan(surveyId: string): Promise<boolean> {
  const surveyRow = await db.query.surveys.findFirst({
    where: and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)),
    columns: { quotaConfig: true },
  });
  const config = normalizeQuotaConfig(surveyRow?.quotaConfig ?? null);
  return config !== null && config.cells.length > 0;
}

/** KPI 카드용 요약만. 미설정이면 null. */
export async function getQuotaSummary(
  surveyId: string,
  scope: OperationsDataScope = 'real',
): Promise<QuotaSummary | null> {
  const status = await getQuotaStatus(surveyId, scope);
  return status?.summary ?? null;
}
