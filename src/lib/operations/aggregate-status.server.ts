import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';

import { mapRowsToCounts, type StatusCounts } from './aggregate-status';

/**
 * 단일 설문의 응답 상태 집계를 반환한다 (서버 전용).
 * 행이 없는 설문은 모든 필드가 0인 객체를 반환한다 (renderer가 empty 처리).
 *
 * 순수 변환 로직은 `aggregate-status.ts`의 `mapRowsToCounts`에 분리되어 있어
 * 단위 테스트에서 db mock 없이 검증한다.
 */
export async function aggregateStatus(surveyId: string): Promise<StatusCounts> {
  const rows = await db
    .select({
      status: surveyResponses.status,
      count: sql<number>`count(*)::int`,
    })
    .from(surveyResponses)
    .where(and(eq(surveyResponses.surveyId, surveyId), isNull(surveyResponses.deletedAt)))
    .groupBy(surveyResponses.status);

  return mapRowsToCounts(rows);
}
