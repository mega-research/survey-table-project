import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { notDeletedResponse } from '@/data/response-filters';

import { mapRowsToCounts, type StatusCounts } from './aggregate-status';
import { responseScopeCondition, type OperationsDataScope } from './data-scope.server';

/**
 * 단일 설문의 응답 상태 집계를 반환한다 (서버 전용).
 * 행이 없는 설문은 모든 필드가 0인 객체를 반환한다 (renderer가 empty 처리).
 *
 * 순수 변환 로직은 `aggregate-status.ts`의 `mapRowsToCounts`에 분리되어 있어
 * 단위 테스트에서 db mock 없이 검증한다.
 */
export async function aggregateStatus(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<StatusCounts> {
  const rows = await db
    .select({
      status: surveyResponses.status,
      count: sql<number>`count(*)::int`,
    })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        notDeletedResponse,
        responseScopeCondition(scope),
      ),
    )
    .groupBy(surveyResponses.status);

  return mapRowsToCounts(rows);
}
