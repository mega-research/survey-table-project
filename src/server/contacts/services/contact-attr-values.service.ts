import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveys } from '@/db/schema';
import { normalizeContactColumnScheme } from '@/lib/operations/contacts';
import {
  targetScopeCondition,
  type OperationsDataScope,
} from '@/server/data-scope.server';
import { FILTER_NONE_VALUE, FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { hydrateProfileColumns } from '@/lib/operations/profile-columns';
import { getProfileColumnScheme } from '@/server/read-models/profile-column-scheme';

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
  /** 이 컬럼이 비어 있는(미기재) 행이 하나라도 있는지 — "(값 없음)" 선택지 노출 판단용. */
  hasEmpty: boolean;
}

/**
 * 헤더 필터 드롭다운용 attrs 컬럼 distinct 값 조회.
 *
 * - 컬럼 스킴 화이트리스트 검증: 보이는(hidden 아님) attrs 컬럼만 허용.
 *   attrs JSONB 는 임의 key 를 담으므로 URL 직접 조작으로 스킴 밖 key 를
 *   열거하는 것을 막는다 (ForbiddenAttrColumnError).
 * - LIMIT+1 조회로 고카디널리티 감지 — 초과 시 truncated=true.
 * - 빈 문자열/미기재 값은 목록에서 제외하고 hasEmpty 플래그로만 알린다. 값 목록에
 *   섞으면 빈 문자열이 체크박스 라벨로 렌더돼 클릭할 수 없는 항목이 되고, 고카디널리티
 *   판정(LIMIT)의 한 자리도 잡아먹는다.
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

  // getContactColumnScheme 를 거치지 않고 직접 읽는 경로라 같은 JSONB 보정이 필요하다.
  const scheme = normalizeContactColumnScheme(schemeRow?.scheme ?? null);
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

  // 값 목록과 "빈 값 존재 여부" 를 한 번에 왕복한다.
  // 빈 값을 DISTINCT 목록에 섞지 않는 이유는 위 주석 참조 — 대신 LIMIT 1 존재 확인만
  // 따로 던진다 (첫 매칭에서 끊기므로 전량 스캔이 아니다).
  const [rows, emptyRows] = await Promise.all([
    db
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
      .limit(ATTR_VALUES_CHECKBOX_LIMIT + 1),
    db
      .select({ id: contactTargets.id })
      .from(contactTargets)
      .where(
        and(
          eq(contactTargets.surveyId, surveyId),
          targetScopeCondition(scope),
          sql`(${valueExpr} IS NULL OR ${valueExpr} = '')`,
        ),
      )
      .limit(1),
  ]);

  const truncated = rows.length > ATTR_VALUES_CHECKBOX_LIMIT;
  // SQL ORDER BY 1 은 텍스트 사전순 — 체크박스 목록은 자연 정렬(숫자 인식)로 재정렬.
  // 체크박스 케이스(≤상한)는 전체가 조회되므로 후정렬로 충분하다.
  const values = rows
    .slice(0, ATTR_VALUES_CHECKBOX_LIMIT)
    .map((r) => r.v)
    // 센티널과 같은 실제 값은 선택지에서 제외 — 파서가 빈 값으로 승격시키므로
    // 노출하면 사용자가 고른 값과 다른 행이 걸린다.
    .filter((v) => v !== FILTER_NONE_VALUE)
    .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  return { values, truncated, hasEmpty: emptyRows.length > 0 };
}
