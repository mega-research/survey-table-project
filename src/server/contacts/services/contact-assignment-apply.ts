import { ORPCError } from '@orpc/server';
import { type SQL, and, eq, sql } from 'drizzle-orm';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { contactAssignments, contactTargets } from '@/db/schema';
import { buildContactsFilterSql } from '@/lib/operations/contacts-filter-sql.server';
import { type FilterClause, parseIdListToken } from '@/lib/operations/filter-shared';
import { type OperationsDataScope, lockWriteScope, testFlagForScope } from '@/server/data-scope';
import { loadIdListsForValues } from '@/server/read-models/contact-id-lists';
import {
  buildColumnCandidates,
  getContactColumnScheme,
  getContactResultCodes,
} from '@/server/read-models/contacts';
import { parseClausesFromUrl } from '@/server/read-models/contacts-filters';
import type { ContactAssignmentClause } from '@/shared/contracts/contacts';

import type {
  ApplyAssignmentInput,
  AssignmentChangeSummary,
  PreviewAssignmentInput,
} from '../domain/contact-assignment';
import { listAssignmentOptions } from './contact-assignments';

/**
 * 교체 적용 — 컨택원 하나의 배정을 조건 결과와 똑같이 만든다 (CONTEXT.md 「교체 적용」).
 * 조건에 맞는 대상은 다른 컨택원에 있었어도 이 컨택원으로 오고, 조건 밖의 기존 배정은
 * 배정 없음이 된다. 조건은 적용하는 순간 다시 평가한다 — 미리보기 이후 명단이 바뀌어도
 * 적용 시점이 정본이고, 실제 결과 집계를 돌려준다.
 */

/**
 * 조건 줄 → 필터 절. 조사 대상 목록 URL 파서와 같은 검증을 배열 입력으로 쓴다.
 *
 * 목록 검색은 해석이 안 되는 절을 조용히 버리지만, 교체 적용에서 절 하나가 빠지면 조건이
 * 넓어져 남의 배정을 끌어오거나 빠질 대상이 남는다. 그래서 하나라도 해석이 안 되면 거부한다.
 * 저장 ID 목록 토큰도 실제 목록을 읽지 못하면 거부한다(0건으로 접혀 전원이 빠지는 사고).
 */
export async function resolveAssignmentClauses(
  surveyId: string,
  scope: OperationsDataScope,
  clauses: ContactAssignmentClause[],
  executor: DbOrTx = db,
): Promise<FilterClause[]> {
  const values = clauses.map((c) => c.value);
  const [scheme, resultCodes, assignments, idLists] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getContactResultCodes(surveyId),
    listAssignmentOptions(surveyId, scope, executor),
    loadIdListsForValues(surveyId, values),
  ]);
  for (const v of values) {
    const token = parseIdListToken(v);
    if (token && !idLists.has(token.id)) {
      throw new ORPCError('BAD_REQUEST', {
        message: '저장된 ID 목록을 찾을 수 없습니다. 목록을 다시 붙여넣어 주세요.',
      });
    }
  }
  const candidates = buildColumnCandidates(scheme, { includeContactOwner: true });
  const parsed = clauses.map(
    (c) =>
      parseClausesFromUrl([c.source], [c.value], [c.op], candidates, resultCodes, {
        idLists,
        assignmentIds: new Set(assignments.map((a) => a.id)),
      })[0],
  );
  const failed = parsed.findIndex((p) => p === undefined);
  if (failed >= 0) {
    throw new ORPCError('BAD_REQUEST', {
      message: `조건 ${failed + 1}을(를) 해석할 수 없습니다. 열과 값을 확인해 주세요.`,
    });
  }
  return parsed.map((p, i) => ({
    condition: p!.condition,
    op: i === 0 ? null : clauses[i]!.op === 'OR' ? 'OR' : 'AND',
  }));
}

/**
 * 조건 결과와 이 컨택원의 지금 배정을 비교한 집계. matchSql 은 NULL 이 섞이지 않는 불리언이어야
 * 한다 — 조건 밖(NOT match)을 셀 때 3값 논리로 빠지지 않게 호출부가 COALESCE 로 감싼다.
 */
async function summarize(
  executor: DbOrTx,
  surveyId: string,
  isTest: boolean,
  assignmentId: string,
  matchSql: SQL,
): Promise<AssignmentChangeSummary> {
  const owner = sql`"contact_targets".assignment_id`;
  const scopeSql = sql`"contact_targets".survey_id = ${surveyId} AND "contact_targets".is_test = ${isTest}`;
  const [totals, others] = await Promise.all([
    executor.execute(sql`
      SELECT
        count(*) FILTER (WHERE ${matchSql})::int AS matched,
        count(*) FILTER (WHERE ${owner} = ${assignmentId})::int AS current,
        count(*) FILTER (WHERE ${matchSql} AND ${owner} IS NULL)::int AS incoming,
        count(*) FILTER (WHERE NOT ${matchSql} AND ${owner} = ${assignmentId})::int AS leaving
      FROM contact_targets
      WHERE ${scopeSql}
    `),
    executor.execute(sql`
      SELECT a.id, a.name, count(*)::int AS n
      FROM contact_targets
      JOIN contact_assignments a ON a.id = "contact_targets".assignment_id
      WHERE ${scopeSql} AND ${matchSql} AND ${owner} <> ${assignmentId}
      GROUP BY a.id, a.name, a."order"
      ORDER BY a."order", a.name
    `),
  ]);
  const t = (totals as unknown as Array<Record<string, unknown>>)[0] ?? {};
  return {
    matched: Number(t['matched'] ?? 0),
    current: Number(t['current'] ?? 0),
    incoming: Number(t['incoming'] ?? 0),
    leaving: Number(t['leaving'] ?? 0),
    fromOthers: (others as unknown as Array<Record<string, unknown>>).map((r) => ({
      id: String(r['id']),
      name: String(r['name']),
      count: Number(r['n']),
    })),
  };
}

/** NULL 없는 불리언 — 조건 밖을 셀 때·풀 때 3값 논리로 빠지는 행이 없게. */
function matchOf(clauses: FilterClause[]): SQL {
  return sql`COALESCE((${buildContactsFilterSql(clauses)}), FALSE)`;
}

async function assertAssignmentInScope(
  executor: DbOrTx,
  surveyId: string,
  isTest: boolean,
  assignmentId: string,
  lock: boolean,
): Promise<void> {
  const query = executor
    .select({ id: contactAssignments.id })
    .from(contactAssignments)
    .where(
      and(
        eq(contactAssignments.id, assignmentId),
        eq(contactAssignments.surveyId, surveyId),
        eq(contactAssignments.isTest, isTest),
      ),
    );
  const rows = lock ? await query.for('update') : await query.limit(1);
  if (rows.length === 0)
    throw new ORPCError('NOT_FOUND', { message: '컨택원을 찾을 수 없습니다.' });
}

/** 미리보기 — 조건에 맞는 인원과 교체하면 바뀌는 인원. 아무것도 쓰지 않는다. */
export async function previewAssignment(
  input: PreviewAssignmentInput,
  scope: OperationsDataScope,
): Promise<AssignmentChangeSummary> {
  const isTest = testFlagForScope(scope);
  await assertAssignmentInScope(db, input.surveyId, isTest, input.assignmentId, false);
  const clauses = await resolveAssignmentClauses(input.surveyId, scope, input.clauses);
  return summarize(db, input.surveyId, isTest, input.assignmentId, matchOf(clauses));
}

/**
 * 교체 적용 — 한 트랜잭션: 쓰기 파티션 잠금 → 컨택원 행 잠금(같은 컨택원 동시 적용 직렬화)
 * → 조건 재평가 → 결과 집계 → 조건 결과를 이 컨택원으로 → 조건 밖의 이 컨택원 배정을 풀기
 * → 마지막 조건·적용 시각 저장. 결과가 0명이어도 적용한다(컨택원을 일부러 비울 수 있게).
 */
export async function applyAssignment(
  input: ApplyAssignmentInput,
): Promise<AssignmentChangeSummary> {
  return db.transaction(async (tx) => {
    const locked = await lockWriteScope(tx, input.surveyId, false, { lock: 'share' });
    if (!locked) throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' });
    await assertAssignmentInScope(tx, input.surveyId, locked.isTest, input.assignmentId, true);

    const clauses = await resolveAssignmentClauses(input.surveyId, locked.scope, input.clauses, tx);
    const match = matchOf(clauses);
    const summary = await summarize(tx, input.surveyId, locked.isTest, input.assignmentId, match);
    const now = new Date();
    const inScope = and(
      eq(contactTargets.surveyId, input.surveyId),
      eq(contactTargets.isTest, locked.isTest),
    );

    await tx
      .update(contactTargets)
      .set({ assignmentId: input.assignmentId, updatedAt: now })
      .where(
        and(
          inScope,
          match,
          sql`${contactTargets.assignmentId} IS DISTINCT FROM ${input.assignmentId}`,
        ),
      );
    await tx
      .update(contactTargets)
      .set({ assignmentId: null, updatedAt: now })
      .where(and(inScope, eq(contactTargets.assignmentId, input.assignmentId), sql`NOT ${match}`));
    await tx
      .update(contactAssignments)
      .set({ lastClauses: input.clauses, lastAppliedAt: now, updatedAt: now })
      .where(eq(contactAssignments.id, input.assignmentId));
    return summary;
  });
}
