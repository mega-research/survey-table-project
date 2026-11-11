import { ORPCError } from '@orpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import 'server-only';

import type { DbTransaction } from '@/db';
import { contactTargets, surveyResponses, surveys } from '@/db/schema';
import {
  type NormalizedContactColumnScheme,
  normalizeContactColumnScheme,
} from '@/lib/operations/contacts-format';
import { type OperationsDataScope, lockWriteScope } from '@/server/data-scope';

import { ensureTestContactColumns } from './test-contact-columns';

export interface PreparedContactInsertScope {
  scope: OperationsDataScope;
  isTest: boolean;
  scheme: NormalizedContactColumnScheme | null;
  existingCount: number;
}

/**
 * 대상자 INSERT 전에 설문 행을 잠그고 현재 DB 모드·스코프·제한을 한 번에 확정한다.
 * 같은 설문의 자동·수동 생성이 이 잠금 아래 직렬화되어 테스트 대상자 20명 제한을 보장한다.
 */
export async function prepareContactInsertScope(
  tx: DbTransaction,
  input: {
    surveyId: string;
    requestedCount: number;
    requireEmptyTestScope: boolean;
    isGuest: boolean;
    /**
     * 이 브라우저의 보기와 무관하게 테스트 파티션에 쓴다 — 실데이터를 보는 채로 누른 「테스트 발송」이
     * 테스트 사본 대상자를 만들 때(`test-send-target`). 전역 테스트 모드가 꺼져 있거나 게스트면 거부한다.
     */
    forceTestScope?: boolean;
  },
): Promise<PreparedContactInsertScope> {
  const locked = await lockWriteScope(tx, input.surveyId, input.isGuest, {
    lock: 'update',
    columns: ['contactColumns', 'testContactColumns'],
  });
  if (!locked) throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' });

  const { row: survey } = locked;
  if (input.forceTestScope && (!survey.enabled || input.isGuest)) {
    throw new ORPCError('CONFLICT', {
      message: '테스트 모드가 꺼져 있어 테스트 대상자를 만들 수 없습니다.',
    });
  }
  const isTest = input.forceTestScope ? true : locked.isTest;
  const scope: OperationsDataScope = input.forceTestScope ? 'test' : locked.scope;
  const [countRow] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(and(eq(contactTargets.surveyId, input.surveyId), eq(contactTargets.isTest, isTest)));
  const existingCount = countRow?.total ?? 0;

  if (input.requireEmptyTestScope && (!isTest || existingCount !== 0)) {
    throw new ORPCError('CONFLICT', { message: 'TEST_TARGET_GENERATION_STALE' });
  }
  if (isTest && existingCount + input.requestedCount > 20) {
    throw new ORPCError('BAD_REQUEST', {
      message: '테스트 대상자는 20명까지 만들 수 있습니다.',
    });
  }

  // 잠금 아래 raw JSONB 를 읽는 지점이라 소비처로 내보내기 전에 형태를 보정한다.
  const scheme = normalizeContactColumnScheme(
    isTest
      ? ensureTestContactColumns(survey.contactColumns, survey.testContactColumns)
      : survey.contactColumns,
  );

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
