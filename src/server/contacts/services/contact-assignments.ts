import { ORPCError } from '@orpc/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import { contactAssignments, contactTargets, surveys } from '@/db/schema';
import { normalizeContactColumnScheme } from '@/lib/operations/contacts-format';
import { matchedResponseSubquery } from '@/lib/operations/contacts-filter-sql.server';
import { logger } from '@/lib/logger';
import { isUniqueViolation, retryOnTxConflict } from '@/lib/pg-error';
import {
  lockWriteScope,
  testFlagForScope,
  type OperationsDataScope,
} from '@/server/data-scope';

import type { ContactAssignmentClause } from '@/shared/contracts/contacts';
import type {
  ContactAssignmentListResult,
  ContactAssignmentStats,
} from '@/shared/contracts/contacts-io';

import type {
  ContactAssignmentOption,
  CreateContactAssignmentInput,
  RemoveContactAssignmentInput,
  RenameContactAssignmentInput,
  ReorderContactAssignmentsInput,
  SetTargetAssignmentInput,
} from '../domain/contact-assignment';
import { ensureContactOwnerColumn } from './scheme-helpers';

/**
 * 컨택원 배정 — 조사 대상을 이름 붙은 묶음(컨택원)에 나눠 맡긴다 (CONTEXT.md 「컨택원 배정」).
 *
 * - 컨택원은 실데이터·테스트 데이터에 따로 있다. 쓰기는 lockWriteScope 가 정한 이 세션의
 *   파티션에서만 하고, 대상과 컨택원의 is_test 가 같아야 한다.
 * - 한 대상은 컨택원 하나에만 속한다(contact_targets.assignment_id). 마지막 배정이 이긴다.
 * - 외부 주체는 procedure 베이스(authed, 내부 계정 전용)에서 막힌다 — 서비스는 외부 주체를 받지 않는다.
 */

/**
 * 배정을 여러 행에 한꺼번에 쓰는 작업(교체 적용·지우기)은 서로 다른 컨택원끼리
 * 겹치는 대상을 다른 순서로 잠가 교착이 날 수 있다. Postgres 가 한쪽을 통째로 되돌리면 그
 * 작업을 처음부터 다시 돌린다 — 조건도 다시 계산하므로 겹치는 대상은 나중에 끝난 쪽이 이긴다
 * (「마지막 배정이 이긴다」). 다시 돈 일은 경고 로그로 남긴다.
 */
export function retryAssignmentWrite<T>(
  rpc: string,
  surveyId: string,
  run: () => Promise<T>,
): Promise<T> {
  return retryOnTxConflict(run, {
    onRetry: (attempt, error) =>
      logger.warn(
        { rpc, surveyId, attempt, err: error instanceof Error ? error.message : String(error) },
        '[contact-assignment] 트랜잭션 충돌 — 다시 실행',
      ),
  });
}

export class DuplicateAssignmentNameError extends Error {
  constructor(name: string) {
    super(`같은 이름의 컨택원이 이미 있습니다: ${name}`);
    this.name = 'DuplicateAssignmentNameError';
  }
}

/**
 * 컨택원 만들기 — 순서는 맨 끝. 같은 설문·파티션 안 같은 이름은 거부한다.
 *
 * 스킴에 「컨택원」 열이 없는 옛 설문은 처음 만들 때 그 파티션 스킴 끝(운영 열 자리)에
 * 덧붙인다 — 따로 열 설정을 손대지 않아도 목록에 열이 생긴다.
 */
export async function createAssignment(
  input: CreateContactAssignmentInput,
): Promise<ContactAssignmentOption> {
  try {
    return await db.transaction(async (tx) => {
      const locked = await lockWriteScope(tx, input.surveyId, false, {
        lock: 'update',
        columns: ['contactColumns', 'testContactColumns'],
      });
      if (!locked) throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' });

      const [last] = await tx
        .select({ max: sql<number | null>`max(${contactAssignments.order})` })
        .from(contactAssignments)
        .where(
          and(
            eq(contactAssignments.surveyId, input.surveyId),
            eq(contactAssignments.isTest, locked.isTest),
          ),
        );
      const [created] = await tx
        .insert(contactAssignments)
        .values({
          surveyId: input.surveyId,
          isTest: locked.isTest,
          name: input.name,
          order: (last?.max ?? 0) + 1,
        })
        .returning({
          id: contactAssignments.id,
          name: contactAssignments.name,
          order: contactAssignments.order,
        });
      if (!created) throw new Error('컨택원을 만들지 못했습니다.');

      await ensureOwnerColumnInScheme(tx, input.surveyId, locked.isTest, {
        contactColumns: locked.row.contactColumns,
        testContactColumns: locked.row.testContactColumns,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateAssignmentNameError(input.name);
    throw error;
  }
}

async function ensureOwnerColumnInScheme(
  tx: DbTransaction,
  surveyId: string,
  isTest: boolean,
  row: { contactColumns: unknown; testContactColumns: unknown },
): Promise<void> {
  const scheme = normalizeContactColumnScheme(isTest ? row.testContactColumns : row.contactColumns);
  // 명단을 아직 올리지 않은 설문은 스킴이 없다 — 업로드가 만드는 스킴에 열이 이미 들어 있다.
  if (!scheme) return;
  const next = ensureContactOwnerColumn(scheme);
  if (next === scheme) return;
  await tx
    .update(surveys)
    .set(isTest ? { testContactColumns: next } : { contactColumns: next })
    .where(eq(surveys.id, surveyId));
}

/**
 * 조사 대상 한 명의 컨택원 바꾸기 — 조사 대상 상세 드롭다운(고르면 바로 저장).
 * assignmentId=null 이면 배정을 푼다. 대상·컨택원 모두 이 세션의 파티션 안에 있어야 한다 —
 * 테스트 대상이 실 컨택원에, 실 대상이 테스트 컨택원에 붙는 길을 막는다.
 */
export async function setTargetAssignment(input: SetTargetAssignmentInput): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await lockWriteScope(tx, input.surveyId, false, { lock: 'share' });
    if (!locked) throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' });

    if (input.assignmentId !== null) {
      const [assignment] = await tx
        .select({ id: contactAssignments.id })
        .from(contactAssignments)
        .where(
          and(
            eq(contactAssignments.id, input.assignmentId),
            eq(contactAssignments.surveyId, input.surveyId),
            eq(contactAssignments.isTest, locked.isTest),
          ),
        )
        .for('share');
      if (!assignment) {
        throw new ORPCError('NOT_FOUND', { message: '컨택원을 찾을 수 없습니다.' });
      }
    }

    const updated = await tx
      .update(contactTargets)
      .set({ assignmentId: input.assignmentId, updatedAt: new Date() })
      .where(
        and(
          eq(contactTargets.id, input.contactTargetId),
          eq(contactTargets.surveyId, input.surveyId),
          eq(contactTargets.isTest, locked.isTest),
        ),
      )
      .returning({ id: contactTargets.id });
    if (updated.length === 0) {
      throw new ORPCError('NOT_FOUND', { message: '조사 대상을 찾을 수 없습니다.' });
    }
  });
}

const EMPTY_STATS: ContactAssignmentStats = {
  assigned: 0,
  completed: 0,
  inProgress: 0,
  notStarted: 0,
};

/**
 * 컨택원 관리 목록 — 컨택원마다 배정·완료·진행 중·미접속 인원 + 배정 없음 줄.
 *
 * 응답 상태는 조사 대상 목록 web 열과 같은 매칭 응답(matchedResponseSubquery)의 status 다 —
 * 두 화면 숫자가 갈리지 않게 같은 식을 쓴다.
 */
export async function listAssignmentsWithStats(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<ContactAssignmentListResult> {
  const isTest = testFlagForScope(scope);
  const [assignmentRows, statRows] = await Promise.all([
    db
      .select({
        id: contactAssignments.id,
        name: contactAssignments.name,
        order: contactAssignments.order,
        lastAppliedAt: contactAssignments.lastAppliedAt,
      })
      .from(contactAssignments)
      .where(and(eq(contactAssignments.surveyId, surveyId), eq(contactAssignments.isTest, isTest)))
      .orderBy(asc(contactAssignments.order), asc(contactAssignments.name)),
    db.execute(sql`
      WITH t AS (
        SELECT "contact_targets".assignment_id AS aid,
               ${matchedResponseSubquery(sql`status`)} AS st
        FROM contact_targets
        WHERE "contact_targets".survey_id = ${surveyId}
          AND "contact_targets".is_test = ${isTest}
      )
      SELECT aid,
             count(*)::int AS assigned,
             count(*) FILTER (WHERE st = 'completed')::int AS completed,
             count(*) FILTER (WHERE st = 'in_progress')::int AS in_progress,
             count(*) FILTER (WHERE st IS NULL)::int AS not_started
      FROM t
      GROUP BY aid
    `),
  ]);

  const statsByAid = new Map<string | null, ContactAssignmentStats>();
  let total = 0;
  for (const r of statRows as unknown as Array<Record<string, unknown>>) {
    const stats: ContactAssignmentStats = {
      assigned: Number(r['assigned'] ?? 0),
      completed: Number(r['completed'] ?? 0),
      inProgress: Number(r['in_progress'] ?? 0),
      notStarted: Number(r['not_started'] ?? 0),
    };
    total += stats.assigned;
    statsByAid.set(r['aid'] == null ? null : String(r['aid']), stats);
  }

  return {
    rows: assignmentRows.map((a) => ({ ...a, stats: statsByAid.get(a.id) ?? EMPTY_STATS })),
    unassigned: statsByAid.get(null) ?? EMPTY_STATS,
    total,
  };
}

/** 이 세션 파티션의 컨택원 행을 잠근다 — 없거나 다른 파티션이면 NOT_FOUND. */
async function lockAssignmentInScope(
  tx: DbTransaction,
  surveyId: string,
  id: string,
): Promise<{ isTest: boolean }> {
  const locked = await lockWriteScope(tx, surveyId, false, { lock: 'share' });
  if (!locked) throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' });
  const [row] = await tx
    .select({ id: contactAssignments.id })
    .from(contactAssignments)
    .where(
      and(
        eq(contactAssignments.id, id),
        eq(contactAssignments.surveyId, surveyId),
        eq(contactAssignments.isTest, locked.isTest),
      ),
    )
    .for('update');
  if (!row) throw new ORPCError('NOT_FOUND', { message: '컨택원을 찾을 수 없습니다.' });
  return { isTest: locked.isTest };
}

/** 이름 바꾸기 — 배정은 그대로. 같은 파티션 안 같은 이름은 거부. */
export async function renameAssignment(input: RenameContactAssignmentInput): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await lockAssignmentInScope(tx, input.surveyId, input.id);
      await tx
        .update(contactAssignments)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(contactAssignments.id, input.id));
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateAssignmentNameError(input.name);
    throw error;
  }
}

/**
 * 순서 바꾸기 — ids 는 이 파티션의 컨택원 전부를 새 순서대로 담아야 한다. 일부만 오거나
 * 남의 id 가 섞이면 거부한다(목록을 연 뒤 다른 사람이 만들거나 지운 경우 — 새로고침 후 다시).
 * 순서는 필터 선택지·진척 보고 줄 순서에 쓰인다.
 */
export async function reorderAssignments(input: ReorderContactAssignmentsInput): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await lockWriteScope(tx, input.surveyId, false, { lock: 'share' });
    if (!locked) throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' });
    const existing = await tx
      .select({ id: contactAssignments.id })
      .from(contactAssignments)
      .where(
        and(
          eq(contactAssignments.surveyId, input.surveyId),
          eq(contactAssignments.isTest, locked.isTest),
        ),
      )
      .for('update');
    const existingIds = new Set(existing.map((r) => r.id));
    const requested = new Set(input.ids);
    const same =
      requested.size === input.ids.length &&
      requested.size === existingIds.size &&
      input.ids.every((id) => existingIds.has(id));
    if (!same) {
      throw new ORPCError('CONFLICT', {
        message: '컨택원 목록이 바뀌었습니다. 새로고침한 뒤 다시 정렬해 주세요.',
      });
    }
    const now = new Date();
    for (const [i, id] of input.ids.entries()) {
      await tx
        .update(contactAssignments)
        .set({ order: i + 1, updatedAt: now })
        .where(eq(contactAssignments.id, id));
    }
  });
}

/** 지우기 — 배정된 대상은 FK(ON DELETE SET NULL)로 배정 없음이 된다. 풀린 인원을 돌려준다. */
export async function removeAssignment(
  input: RemoveContactAssignmentInput,
): Promise<{ unassigned: number }> {
  // 지우기는 FK 로 배정된 대상 전부를 풀어 교체 적용과 교착이 날 수 있다.
  return retryAssignmentWrite('contacts.assignments.remove', input.surveyId, () =>
    removeAssignmentOnce(input),
  );
}

async function removeAssignmentOnce(
  input: RemoveContactAssignmentInput,
): Promise<{ unassigned: number }> {
  return db.transaction(async (tx) => {
    await lockAssignmentInScope(tx, input.surveyId, input.id);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(contactTargets)
      .where(eq(contactTargets.assignmentId, input.id));
    await tx.delete(contactAssignments).where(eq(contactAssignments.id, input.id));
    return { unassigned: Number(count?.n ?? 0) };
  });
}


/** 컨택원 수정 화면 — 이 세션 파티션의 컨택원 하나 (마지막 조건 포함). 없으면 null. */
export async function getAssignmentForEdit(
  surveyId: string,
  scope: OperationsDataScope,
  id: string,
): Promise<{
  id: string;
  name: string;
  lastClauses: ContactAssignmentClause[] | null;
  lastAppliedAt: Date | null;
} | null> {
  const [row] = await db
    .select({
      id: contactAssignments.id,
      name: contactAssignments.name,
      lastClauses: contactAssignments.lastClauses,
      lastAppliedAt: contactAssignments.lastAppliedAt,
    })
    .from(contactAssignments)
    .where(
      and(
        eq(contactAssignments.id, id),
        eq(contactAssignments.surveyId, surveyId),
        eq(contactAssignments.isTest, testFlagForScope(scope)),
      ),
    )
    .limit(1);
  if (!row) return null;
  // JSONB 드리프트 보정 — 배열이 아닌 저장분은 조건 없음으로 읽는다.
  return { ...row, lastClauses: Array.isArray(row.lastClauses) ? row.lastClauses : null };
}

/** 이 파티션에서 컨택원에 배정된 대상 수 — 교체 업로드 경고(「배정 N명이 풀립니다」). */
export async function countAssignedTargets(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.isTest, testFlagForScope(scope)),
        sql`${contactTargets.assignmentId} IS NOT NULL`,
      ),
    );
  return Number(row?.n ?? 0);
}
