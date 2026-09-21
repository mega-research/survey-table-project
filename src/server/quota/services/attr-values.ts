import { and, eq, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { loadOperationsDataScope, targetScopeCondition } from '@/server/data-scope';

/** 속성형 차원의 카테고리 초안으로 쓸 고유 값 상한 — 이보다 많으면 쿼터 축으로 쓸 열이 아니다. */
export const MAX_QUOTA_ATTR_VALUES = 50;

export interface QuotaAttrValues {
  /** 빈 값 제외, 앞뒤 공백 정돈, 값 순 정렬. 상한까지만. */
  values: string[];
  /** 고유 값이 상한을 넘었는가 */
  truncated: boolean;
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
  const value = sql<string>`btrim(${contactTargets.attrs} ->> ${attrKey})`;
  const rows = await db
    .selectDistinct({ value })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        targetScopeCondition(scope),
        sql`${value} <> ''`,
      ),
    )
    .orderBy(value)
    .limit(MAX_QUOTA_ATTR_VALUES + 1);

  const values = rows.map((r) => r.value);
  return {
    values: values.slice(0, MAX_QUOTA_ATTR_VALUES),
    truncated: values.length > MAX_QUOTA_ATTR_VALUES,
  };
}
