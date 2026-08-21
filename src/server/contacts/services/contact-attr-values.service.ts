import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveys } from '@/db/schema';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import {
  targetScopeCondition,
  type OperationsDataScope,
} from '@/server/shared/data-scope.server';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { hydrateProfileColumns } from '@/lib/operations/profile-columns';
import { getProfileColumnScheme } from '@/lib/operations/profile-columns.server';

/**
 * 헤더 필터 드롭다운의 체크박스 표시 상한.
 * distinct 가 이 수를 넘으면 truncated=true 로 응답하고 클라이언트는
 * 부분검색 입력 모드로 폴백한다.
 */
export const ATTR_VALUES_CHECKBOX_LIMIT = 20;

export class ForbiddenAttrColumnError extends Error {
  constructor(attrsKey: string) {
    super(`컬럼 스킴에 없는 attrs 컬럼: ${attrsKey}`);
    this.name = 'ForbiddenAttrColumnError';
  }
}

export interface ListContactAttrValuesInput {
  surveyId: string;
  attrsKey: string;
  scope: OperationsDataScope;
}

export interface ListContactAttrValuesResult {
  values: string[];
  truncated: boolean;
}

/**
 * 헤더 필터 드롭다운용 attrs 컬럼 distinct 값 조회.
 *
 * - 컬럼 스킴 화이트리스트 검증: 보이는(hidden 아님) attrs 컬럼만 허용.
 *   attrs JSONB 는 임의 key 를 담으므로 URL 직접 조작으로 스킴 밖 key 를
 *   열거하는 것을 막는다 (ForbiddenAttrColumnError).
 * - LIMIT+1 조회로 고카디널리티 감지 — 초과 시 truncated=true.
 * - 빈 문자열 값은 제외 (표에서 — 로 표시되는 미기재 행).
 */
export async function listContactAttrValues(
  input: ListContactAttrValuesInput,
): Promise<ListContactAttrValuesResult> {
  const { surveyId, attrsKey, scope } = input;

  const [schemeRow] = await db
    .select({
      scheme: scope === 'test' ? surveys.testContactColumns : surveys.contactColumns,
    })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);

  const scheme = (schemeRow?.scheme as ContactColumnScheme | null) ?? null;
  const source = `${FILTER_SOURCE.ATTRS_PREFIX}${attrsKey}`;
  let allowed = scheme?.columns.some((c) => c.source === source && !c.hidden) ?? false;
  if (!allowed) {
    // 응답 내역 표시 스킴은 조사 대상 스킴과 독립적으로 attrs 컬럼을 표시할 수 있다 —
    // 조사 대상에선 숨기고 응답 내역에서만 표시한 컬럼의 깔때기 distinct 조회를
    // 거부하지 않도록 응답 내역 표시 여부도 허용 축으로 인정한다.
    const profileScheme = await getProfileColumnScheme(surveyId);
    allowed = hydrateProfileColumns(scheme, profileScheme).some(
      (c) => c.key === source && !c.hidden,
    );
  }
  if (!allowed) throw new ForbiddenAttrColumnError(attrsKey);

  const valueExpr = sql<string>`${contactTargets.attrs} ->> ${attrsKey}`;
  const rows = await db
    .selectDistinct({ v: valueExpr })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        targetScopeCondition(scope),
        sql`${valueExpr} IS NOT NULL AND ${valueExpr} <> ''`,
      ),
    )
    // ORDER BY 1 (위치 지정) 필수 — ${valueExpr} 를 그대로 쓰면 attrsKey 가 별도
    // placeholder 로 바인딩되어 select list 의 식과 "다른 식"이 되고, PG 가
    // "for SELECT DISTINCT, ORDER BY expressions must appear in select list" 로 거부한다.
    .orderBy(sql`1`)
    .limit(ATTR_VALUES_CHECKBOX_LIMIT + 1);

  const truncated = rows.length > ATTR_VALUES_CHECKBOX_LIMIT;
  // SQL ORDER BY 1 은 텍스트 사전순 — 체크박스 목록은 자연 정렬(숫자 인식)로 재정렬.
  // 체크박스 케이스(≤상한)는 전체가 조회되므로 후정렬로 충분하다.
  const values = rows
    .slice(0, ATTR_VALUES_CHECKBOX_LIMIT)
    .map((r) => r.v)
    .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  return { values, truncated };
}
