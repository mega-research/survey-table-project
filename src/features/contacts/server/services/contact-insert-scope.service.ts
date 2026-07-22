import { and, eq, isNull, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets, surveyResponses, surveys } from '@/db/schema';
import type { ContactColumnScheme } from '@/db/schema/schema-types';
import { ensureTestContactColumns } from '@/lib/contacts/test-contact-columns';
import type { OperationsDataScope } from '@/lib/operations/data-scope.server';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface SurveyScopeRow extends Record<string, unknown> {
  id: string;
  test_mode_enabled: boolean;
  contact_columns: ContactColumnScheme | null;
  test_contact_columns: ContactColumnScheme | null;
}

export interface PreparedContactInsertScope {
  scope: OperationsDataScope;
  isTest: boolean;
  scheme: ContactColumnScheme | null;
  existingCount: number;
}

/**
 * 대상자 INSERT 전에 설문 행을 잠그고 현재 DB 모드·스코프·제한을 한 번에 확정한다.
 * 같은 설문의 자동·수동 생성이 이 잠금 아래 직렬화되어 테스트 대상자 20명 제한을 보장한다.
 */
export async function prepareContactInsertScope(
  tx: DbTransaction,
  input: { surveyId: string; requestedCount: number; requireEmptyTestScope: boolean },
): Promise<PreparedContactInsertScope> {
  const rows = await tx.execute<SurveyScopeRow>(sql`
    SELECT id, test_mode_enabled, contact_columns, test_contact_columns
    FROM surveys
    WHERE id = ${input.surveyId}::uuid
    FOR UPDATE
  `);
  const survey = rows[0];
  if (!survey) throw new Error('설문을 찾을 수 없습니다.');

  const isTest = survey.test_mode_enabled;
  const scope: OperationsDataScope = isTest ? 'test' : 'real';
  const [countRow] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(and(eq(contactTargets.surveyId, input.surveyId), eq(contactTargets.isTest, isTest)));
  const existingCount = countRow?.total ?? 0;

  if (input.requireEmptyTestScope && (!isTest || existingCount !== 0)) {
    throw new Error('TEST_TARGET_GENERATION_STALE');
  }
  if (isTest && existingCount + input.requestedCount > 20) {
    throw new Error('TEST_TARGET_LIMIT');
  }

  const scheme = isTest
    ? ensureTestContactColumns(survey.contact_columns, survey.test_contact_columns)
    : survey.contact_columns;

  if (isTest && existingCount === 0) {
    await tx
      .delete(surveyResponses)
      .where(
        and(
          eq(surveyResponses.surveyId, input.surveyId),
          eq(surveyResponses.isTest, true),
          isNull(surveyResponses.contactTargetId),
        ),
      );
    await tx
      .update(surveys)
      .set({ testContactColumns: scheme })
      .where(eq(surveys.id, input.surveyId));
  }

  return { scope, isTest, scheme, existingCount };
}
