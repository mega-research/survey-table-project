import { ORPCError } from '@orpc/server';
import { sql, type SQL } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import {
  effectiveMailStatusExpr,
  latestResultCodeExpr,
  matchedResponseSubquery,
} from '@/lib/operations/contacts-filter-sql.server';
import {
  FILTER_NONE_LABEL,
  FILTER_NONE_VALUE,
  FILTER_SOURCE,
  MAIL_FILTER_OPTIONS,
  WEB_FILTER_OPTIONS,
  contactResultFilterOptions,
} from '@/lib/operations/filter-shared';
import { testFlagForScope, type OperationsDataScope } from '@/server/data-scope';
import { getContactResultCodes } from '@/server/read-models/contacts';

import type { AssignmentFacetsOutput } from '../domain/contact-assignment';
import { ATTR_VALUES_CHECKBOX_LIMIT, assertAttrColumnAllowed } from './contact-attr-values';
import { listAssignmentOptions } from './contact-assignments';

/**
 * 컨택원 수정 화면 오른쪽 값 목록 — 조건 줄이 고른 열의 값과 값별 인원(명단 전체 기준).
 *
 * 체크박스로 그리는 열은 조사 대상 열 머리 필터와 같은 기준이다: 결과코드·응답 상태·메일·
 * 현재 컨택원은 고정 선택지, attrs 는 값 종류가 체크박스 상한(20) 이하일 때만. 그 밖(시스템ID·
 * 개인정보·값이 많은 attrs)은 'many' 로 답해 화면이 조건에 맞는 대상 목록을 그린다.
 */
export async function listAssignmentFacets(
  surveyId: string,
  scope: OperationsDataScope,
  source: string,
): Promise<AssignmentFacetsOutput> {
  const isTest = testFlagForScope(scope);

  if (source.startsWith(FILTER_SOURCE.ATTRS_PREFIX)) {
    const key = source.slice(FILTER_SOURCE.ATTRS_PREFIX.length);
    await assertAttrColumnAllowed(surveyId, key, scope);
    // 빈 문자열과 키 부재를 한 값(빈 값)으로 접는다 — 표가 둘 다 '—' 로 그린다.
    const valueExpr = sql`NULLIF("contact_targets".attrs->>${key}, '')`;
    const counts = await countBy(surveyId, isTest, valueExpr, ATTR_VALUES_CHECKBOX_LIMIT + 2);
    const nonEmpty = counts.filter((c) => c.value !== null);
    if (nonEmpty.length > ATTR_VALUES_CHECKBOX_LIMIT) return { kind: 'many' };
    const values = nonEmpty
      // 센티널과 같은 실제 값은 선택지에서 뺀다 — 파서가 빈 값으로 승격시킨다.
      .filter((c) => c.value !== FILTER_NONE_VALUE)
      .map((c) => ({ value: c.value!, label: c.value!, count: c.count }))
      .sort((a, b) => a.value.localeCompare(b.value, 'ko', { numeric: true }));
    return withNone(values, counts);
  }

  if (source === FILTER_SOURCE.CONTACT_RESULT) {
    const resultCodes = await getContactResultCodes(surveyId);
    const counts = await countBy(surveyId, isTest, latestResultCodeExpr);
    return fixed(contactResultFilterOptions(resultCodes), counts);
  }

  if (source === FILTER_SOURCE.WEB) {
    const counts = await countBy(surveyId, isTest, matchedResponseSubquery(sql`status`));
    // 응답 없음은 'none' 값이 고정 선택지 안에 있다 (표의 '—').
    return fixed(
      WEB_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      counts.map((c) => (c.value === null ? { ...c, value: 'none' } : c)),
    );
  }

  if (source === FILTER_SOURCE.EMAIL) {
    const counts = await countBy(surveyId, isTest, effectiveMailStatusExpr);
    return fixed(
      MAIL_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      counts.map((c) => (c.value === null ? { ...c, value: 'none' } : c)),
    );
  }

  if (source === FILTER_SOURCE.CONTACT_OWNER) {
    const [assignments, counts] = await Promise.all([
      listAssignmentOptions(surveyId, scope),
      countBy(surveyId, isTest, sql`"contact_targets".assignment_id::text`),
    ]);
    return fixed(
      [
        ...assignments.map((a) => ({ value: a.id, label: a.name })),
        { value: FILTER_NONE_VALUE, label: FILTER_NONE_LABEL },
      ],
      counts,
    );
  }

  if (source === FILTER_SOURCE.RESID || source.startsWith(FILTER_SOURCE.PII_PREFIX)) {
    return { kind: 'many' };
  }
  throw new ORPCError('BAD_REQUEST', { message: '값 목록을 낼 수 없는 열입니다.' });
}

interface ValueCount {
  value: string | null;
  count: number;
}

async function countBy(
  surveyId: string,
  isTest: boolean,
  valueExpr: SQL,
  limit?: number,
): Promise<ValueCount[]> {
  const rows = await db.execute(sql`
    SELECT v, count(*)::int AS n FROM (
      SELECT ${valueExpr} AS v
      FROM contact_targets
      WHERE "contact_targets".survey_id = ${surveyId}
        AND "contact_targets".is_test = ${isTest}
    ) t
    GROUP BY v
    ORDER BY n DESC
    ${limit !== undefined ? sql`LIMIT ${limit}` : sql``}
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    value: r['v'] == null ? null : String(r['v']),
    count: Number(r['n'] ?? 0),
  }));
}

/** 고정 선택지 순서대로 인원을 붙인다. 빈 값(null)은 FILTER_NONE_VALUE 선택지의 인원이다. */
function fixed(
  options: Array<{ value: string; label: string }>,
  counts: ValueCount[],
): AssignmentFacetsOutput {
  const byValue = new Map(counts.map((c) => [c.value ?? FILTER_NONE_VALUE, c.count]));
  return {
    kind: 'values',
    values: options.map((o) => ({ ...o, count: byValue.get(o.value) ?? 0 })),
    total: counts.reduce((n, c) => n + c.count, 0),
  };
}

/** attrs 값 목록 끝에 빈 값 줄 — 빈 값 행이 실제로 있을 때만. */
function withNone(
  values: Array<{ value: string; label: string; count: number }>,
  counts: ValueCount[],
): AssignmentFacetsOutput {
  const empty = counts.find((c) => c.value === null)?.count ?? 0;
  return {
    kind: 'values',
    values: [
      ...values,
      ...(empty > 0 ? [{ value: FILTER_NONE_VALUE, label: FILTER_NONE_LABEL, count: empty }] : []),
    ],
    total: counts.reduce((n, c) => n + c.count, 0),
  };
}
