import { ORPCError } from '@orpc/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import 'server-only';

import { type DbOrTx, type DbTransaction, db } from '@/db';
import { contactAssignments, contactTargets, surveys } from '@/db/schema';
import { normalizeContactColumnScheme } from '@/lib/operations/contacts-format';
import { isUniqueViolation } from '@/lib/pg-error';
import {
  lockWriteScope,
  testFlagForScope,
  type OperationsDataScope,
} from '@/server/data-scope';

import type {
  ContactAssignmentOption,
  CreateContactAssignmentInput,
  SetTargetAssignmentInput,
} from '../domain/contact-assignment';
import { ensureContactOwnerColumn } from './scheme-helpers';

/**
 * 컨택원 배정 — 조사 대상을 이름 붙은 묶음(컨택원)에 나눠 맡긴다 (CONTEXT.md 「컨택원 배정」).
 *
 * - 컨택원은 실데이터·테스트 데이터에 따로 있다. 쓰기는 lockWriteScope 가 정한 이 세션의
 *   파티션에서만 하고, 대상과 컨택원의 is_test 가 같아야 한다.
 * - 한 대상은 컨택원 하나에만 속한다(contact_targets.assignment_id). 마지막 배정이 이긴다.
 * - 게스트는 procedure 베이스(authed)에서 막힌다 — 서비스는 게스트를 받지 않는다.
 */

export class DuplicateAssignmentNameError extends Error {
  constructor(name: string) {
    super(`같은 이름의 컨택원이 이미 있습니다: ${name}`);
    this.name = 'DuplicateAssignmentNameError';
  }
}

/** 이 설문·파티션의 컨택원 — 순서대로(같으면 이름순). */
export async function listAssignmentOptions(
  surveyId: string,
  scope: OperationsDataScope,
  executor: DbOrTx = db,
): Promise<ContactAssignmentOption[]> {
  return executor
    .select({
      id: contactAssignments.id,
      name: contactAssignments.name,
      order: contactAssignments.order,
    })
    .from(contactAssignments)
    .where(
      and(
        eq(contactAssignments.surveyId, surveyId),
        eq(contactAssignments.isTest, testFlagForScope(scope)),
      ),
    )
    .orderBy(asc(contactAssignments.order), asc(contactAssignments.name));
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
