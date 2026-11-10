import { and, eq, isNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyResponses, surveys } from '@/db/schema/surveys';
import {
  loadCompletedQuotaSubjects,
  loadCompletedQuotaSubjectsWithShare,
} from '@/server/read-models/completed-answers';

import { EXTERNAL_VIEWER_DATA_SCOPE, type OperationsDataScope } from '@/server/data-scope';
import { type FieldworkShare, isShareRestricted, shareTargetCondition } from '@/server/fieldwork-share';
import {
  type QuotaStatus,
  type QuotaSummary,
  type QuotaView,
  type ShareQuotaStatus,
  buildQuotaStatus,
  buildShareQuotaStatus,
} from '@/lib/quota/quota-status-calc';
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
 * 나눈 외주 실사 링크가 보는 쿼터 현황 — 셀마다 **내 달성 수와 셀 마감 여부만** (fieldwork-multi-company 티켓 08).
 * 쿼터 미설정이면 null.
 *
 * 전체 목표·전체 달성 수는 외주의 화면에도 RSC payload 에도 싣지 않는다(PRD 스토리 41) — 업체가 여럿이면 남의
 * 몫을 짐작할 재료가 된다. **한 번도 나누지 않은 링크는 이 투영이 아니다**(스토리 22 「안 나누면 지금과 똑같다」,
 * 2026-11-10 연구원 결정) — 갈래는 `getQuotaViewForShare` 하나가 정한다.
 *
 * 마감은 설문 전체 실데이터 완료로 판정한다 — 집행(`checkQuota`)과 같은 모수·같은 술어라 「외주 화면은 열림인데
 * 응답자는 마감」이 생기지 않는다. 파티션은 실데이터 상수다(외부 주체는 언제나 실데이터를 본다).
 */
export async function getShareQuotaStatus(
  surveyId: string,
  share: FieldworkShare,
): Promise<ShareQuotaStatus | null> {
  const surveyRow = await db.query.surveys.findFirst({
    where: and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)),
    columns: { quotaConfig: true },
  });
  const config = normalizeQuotaConfig(surveyRow?.quotaConfig ?? null);
  if (!config) return null;

  const { all, mine } = await loadCompletedQuotaSubjectsWithShare(surveyId, EXTERNAL_VIEWER_DATA_SCOPE, {
    withAttrs: needsContactAttrs(config),
    shareCondition: shareTargetCondition(share, surveyResponses.contactTargetId),
  });
  return buildShareQuotaStatus(config, all, mine);
}

/**
 * 쿼터 현황의 갈래 — 담당 범위 하나로 정한다. **화면은 이 함수만 부른다**(응답 현황의 쿼터 조각·`/fw` 쿼터 화면).
 *
 * - 거르는 범위(`targets`·`none` — 나눈 외주 링크)면 내 몫 투영(`getShareQuotaStatus`).
 * - `all`(계정 주체·클라이언트 링크·한 번도 나누지 않은 외주 링크)이면 설문 전체 현황(`getQuotaStatus`). 나누지
 *   않은 외주 링크는 업체 하나인 설문이라 지금처럼 목표·달성 수를 본다(스토리 22).
 *
 * `scope` 는 전체 현황에만 쓴다 — 외주 링크는 언제나 실데이터라 호출부가 넘기는 값도 `real` 이다.
 */
export async function getQuotaViewForShare(
  surveyId: string,
  scope: OperationsDataScope,
  share: FieldworkShare,
): Promise<QuotaView | null> {
  if (isShareRestricted(share)) {
    const status = await getShareQuotaStatus(surveyId, share);
    return status ? { kind: 'share', status } : null;
  }
  const status = await getQuotaStatus(surveyId, scope);
  return status ? { kind: 'full', status } : null;
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
