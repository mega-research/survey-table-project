import { ORPCError } from '@orpc/server';
import { type SQL, and, eq, sql } from 'drizzle-orm';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { contactAssignments, contactTargets } from '@/db/schema';
import { buildContactsFilterSql } from '@/lib/operations/contacts-filter-sql.server';
import { type OperationsDataScope, lockWriteScope, testFlagForScope } from '@/server/data-scope';
import {
  type ResolvedContactFilter,
  loadContactFilterContext,
  resolveContactFilter,
} from '@/server/read-models/contact-filter-resolution';
import { listContactsForSurvey } from '@/server/read-models/contacts';
import type { ContactAssignmentClause } from '@/shared/contracts/contacts';
import type { ContactAssignmentMatchesResult } from '@/shared/contracts/contacts-io';

import type {
  ApplyAssignmentInput,
  AssignmentChangeSummary,
  AssignmentMatchesInput,
  PreviewAssignmentInput,
} from '../domain/contact-assignment';
import { retryAssignmentWrite } from './contact-assignments';

/**
 * 교체 적용 — 컨택원 하나의 배정을 조건 결과와 똑같이 만든다 (CONTEXT.md 「교체 적용」).
 * 조건에 맞는 대상은 다른 컨택원에 있었어도 이 컨택원으로 오고, 조건 밖의 기존 배정은
 * 배정 없음이 된다. 조건은 적용하는 순간 다시 평가한다 — 미리보기 이후 명단이 바뀌어도
 * 적용 시점이 정본이고, 실제 결과 집계를 돌려준다.
 */

/**
 * 조건 줄 → 해석 결과(write). 조사 대상 목록과 같은 해석이되, 목록 검색은 해석이 안 되는 조건을
 * 조용히 버리지만 교체 적용에서 조건 하나가 빠지면 조건이 넓어져 남의 배정을 끌어오거나 빠질
 * 대상이 남는다 — write 해석은 그런 조건(읽지 못한 ID 목록 포함)이 하나라도 있으면 거부한다.
 * 교체 적용은 게스트가 없다(authed). 컨택원은 호출자의 트랜잭션으로 읽는다.
 */
async function resolveAssignmentFilter(
  surveyId: string,
  scope: OperationsDataScope,
  clauses: ContactAssignmentClause[],
  executor: DbOrTx = db,
): Promise<ResolvedContactFilter<'write'>> {
  const ctx = await loadContactFilterContext(surveyId, scope, {
    isGuest: false,
    surface: 'contacts',
    executor,
  });
  return resolveContactFilter(ctx, { clauses }, { mode: 'write' });
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
function matchOf(filter: ResolvedContactFilter<'write'>): SQL {
  return sql`COALESCE((${buildContactsFilterSql(filter.clauses)}), FALSE)`;
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
  const filter = await resolveAssignmentFilter(input.surveyId, scope, input.clauses);
  return summarize(db, input.surveyId, isTest, input.assignmentId, matchOf(filter));
}

/**
 * 교체 적용 — 한 트랜잭션: 쓰기 파티션 잠금 → 컨택원 행 잠금(같은 컨택원 동시 적용 직렬화)
 * → 조건 재평가 → 결과 집계 → 조건 결과를 이 컨택원으로 → 조건 밖의 이 컨택원 배정을 풀기
 * → 마지막 조건·적용 시각 저장. 결과가 0명이어도 적용한다(컨택원을 일부러 비울 수 있게).
 */
export async function applyAssignment(
  input: ApplyAssignmentInput,
): Promise<AssignmentChangeSummary> {
  // 교착으로 되돌려지면 처음부터 다시 — retryAssignmentWrite 주석 참조.
  return retryAssignmentWrite('contacts.assignments.apply', input.surveyId, () =>
    applyAssignmentOnce(input),
  );
}

async function applyAssignmentOnce(
  input: ApplyAssignmentInput,
): Promise<AssignmentChangeSummary> {
  return db.transaction(async (tx) => {
    const locked = await lockWriteScope(tx, input.surveyId, false, { lock: 'share' });
    if (!locked) throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' });
    await assertAssignmentInScope(tx, input.surveyId, locked.isTest, input.assignmentId, true);

    const filter = await resolveAssignmentFilter(input.surveyId, locked.scope, input.clauses, tx);
    const match = matchOf(filter);
    const summary = await summarize(tx, input.surveyId, locked.isTest, input.assignmentId, match);
    const now = new Date();
    const inScope = and(
      eq(contactTargets.surveyId, input.surveyId),
      eq(contactTargets.isTest, locked.isTest),
    );

    // 들어옴·빠짐을 한 문장으로 쓴다 — 조건이 「현재 컨택원」·「배정 없음」이면 앞 문장이 바꾼
    // assignment_id 를 뒤 문장이 다시 읽어 방금 옮긴 대상을 도로 풀거나(B→A 가 다시 없음) 방금
    // 푼 대상을 도로 끌어온다. 한 UPDATE 안에서는 모든 행이 문장 시작 시점의 상태로 한 번만
    // 판정된다(상관 서브쿼리도 같은 스냅숏을 읽는다).
    await tx
      .update(contactTargets)
      .set({
        assignmentId: sql`CASE WHEN ${match} THEN ${input.assignmentId}::uuid ELSE NULL END`,
        updatedAt: now,
      })
      .where(
        and(
          inScope,
          sql`((${match} AND ${contactTargets.assignmentId} IS DISTINCT FROM ${input.assignmentId}::uuid)
            OR (NOT ${match} AND ${contactTargets.assignmentId} = ${input.assignmentId}::uuid))`,
        ),
      );
    await tx
      .update(contactAssignments)
      .set({ lastClauses: input.clauses, lastAppliedAt: now, updatedAt: now })
      .where(eq(contactAssignments.id, input.assignmentId));
    return summary;
  });
}

/** 오른쪽 대상 목록 한 쪽의 인원. */
export const ASSIGNMENT_MATCHES_PAGE_SIZE = 10;

/**
 * 조건에 맞는 대상 목록(시스템ID 순, 10명씩) — 컨택원 수정 화면 오른쪽. 조사 대상 목록과
 * 같은 read model 을 써서 같은 조건이면 같은 사람이 나오고, 개인정보 열은 같은 마스킹 힌트만 싣는다.
 */
export async function listAssignmentMatches(
  input: AssignmentMatchesInput,
  scope: OperationsDataScope,
): Promise<ContactAssignmentMatchesResult> {
  const filter = await resolveAssignmentFilter(input.surveyId, scope, input.clauses);
  const { rows, total, page } = await listContactsForSurvey({
    surveyId: input.surveyId,
    scope,
    filter,
    page: input.page,
    pageSize: ASSIGNMENT_MATCHES_PAGE_SIZE,
    sort: 'resid',
    dir: 'asc',
  });
  return {
    rows: rows.map((r) => ({
      id: r.id,
      resid: r.resid,
      attrs: r.attrs,
      piiMaskHints: r.piiMaskHints,
      assignment: r.assignment,
    })),
    total,
    page,
    pageSize: ASSIGNMENT_MATCHES_PAGE_SIZE,
  };
}
