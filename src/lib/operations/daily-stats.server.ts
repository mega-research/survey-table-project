import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { notDeletedResponse } from '@/data/response-filters';

import {
  shapeDailyStats,
  type DailyStatsRawRow,
  type DailyStatsRow,
} from './daily-stats';

/**
 * 단일 설문의 일자별 통계(총/완료/드롭)를 반환한다 (서버 전용).
 *
 * KST 기준 정책:
 *   - `(started_at AT TIME ZONE 'Asia/Seoul')::date` 로 그룹핑.
 *   - 단일 쿼리에서 conditional sum (FILTER) 으로 completed / drop 카운트를 함께 계산.
 *
 * 순수 변환 로직(완료율·컬럼 비율·정렬·라벨)은 `daily-stats.ts`의
 * `shapeDailyStats`에 위임하여 테스트 가능하게 분리한다.
 */
export async function getDailyStats(surveyId: string): Promise<DailyStatsRow[]> {
  const rows = await db
    .select({
      date: sql<string>`((${surveyResponses.startedAt} AT TIME ZONE 'Asia/Seoul')::date)::text`,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${surveyResponses.status} = 'completed')::int`,
      drop: sql<number>`count(*) FILTER (WHERE ${surveyResponses.status} = 'drop')::int`,
    })
    .from(surveyResponses)
    .where(and(eq(surveyResponses.surveyId, surveyId), notDeletedResponse))
    .groupBy(sql`1`)
    .orderBy(sql`1 DESC`);

  // SQL 쪽에서 이미 DESC 정렬을 하지만, shapeDailyStats가 자체적으로 정렬 책임을 갖도록 둔다
  // (테스트에서 어떤 순서로 들어와도 동작 보장).
  return shapeDailyStats(rows as DailyStatsRawRow[]);
}
