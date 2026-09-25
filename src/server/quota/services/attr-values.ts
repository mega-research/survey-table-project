import { and, eq, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import {
  type OperationsDataScope,
  loadOperationsDataScope,
  targetScopeCondition,
} from '@/server/data-scope';

/** 속성형 차원의 카테고리 초안으로 쓸 고유 값 상한 — 이보다 많으면 쿼터 축으로 쓸 열이 아니다. */
export const MAX_QUOTA_ATTR_VALUES = 50;

export interface QuotaAttrValues {
  /** 빈 값 제외, 앞뒤 공백 정돈, 값 순 정렬. 상한까지만. */
  values: string[];
  /** 고유 값이 상한을 넘었는가 */
  truncated: boolean;
}

/**
 * 고유 값 질의. 실행기(`db`)를 받아 만들기만 한다 — SQL 모양을 테스트가 직접 본다.
 */
export function buildAttrValuesQuery(
  database: Pick<typeof db, 'select' | 'selectDistinct'>,
  surveyId: string,
  attrKey: string,
  scope: OperationsDataScope,
) {
  // 키는 안쪽 질의에서 **한 번만** 바인딩한다. 같은 식을 select·where·order by 에 각각 쓰면
  // 파라미터가 $1·$4·$5 로 따로 묶여 Postgres 가 서로 다른 식으로 보고, SELECT DISTINCT 의
  // "ORDER BY 식은 select 목록에 있어야 한다" 규칙에 걸린다 (2026-09-21 프로덕션 500).
  const trimmed = database
    .select({ value: sql<string>`btrim(${contactTargets.attrs} ->> ${attrKey})`.as('value') })
    .from(contactTargets)
    .where(and(eq(contactTargets.surveyId, surveyId), targetScopeCondition(scope)))
    .as('trimmed');
  return database
    .selectDistinct({ value: trimmed.value })
    .from(trimmed)
    .where(sql`${trimmed.value} <> ''`)
    .orderBy(trimmed.value)
    .limit(MAX_QUOTA_ATTR_VALUES + 1);
}

/**
 * 조사 대상 명단에서 attrs 열 하나의 고유 값 목록 (현재 운영 파티션).
 * 쿼터 편집 화면이 속성형 차원을 만들 때 카테고리를 자동으로 채우는 데 쓴다.
 */
export async function listQuotaAttrValues(
  surveyId: string,
  attrKey: string,
): Promise<QuotaAttrValues> {
  const scope = await loadOperationsDataScope(surveyId);
  const rows = await buildAttrValuesQuery(db, surveyId, attrKey, scope);

  const values = rows.map((r) => r.value);
  return {
    values: values.slice(0, MAX_QUOTA_ATTR_VALUES),
    truncated: values.length > MAX_QUOTA_ATTR_VALUES,
  };
}
