import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { notDeletedResponse, notTestResponse } from '@/data/response-filters';

import {
  shapeDailyBuckets,
  type DailyBucket,
  type DailyMode,
  type DailyRow,
} from './aggregate-daily';

/**
 * 단일 설문의 일자(또는 시간)별 응답 시작 카운트를 반환한다 (서버 전용).
 *
 * KST 기준 정책:
 *   - day 모드: `(started_at AT TIME ZONE 'Asia/Seoul')::date` 로 그룹.
 *   - hour 모드: `date_trunc('hour', started_at AT TIME ZONE 'Asia/Seoul')` 로 그룹,
 *     선택한 일자(KST)에 해당하는 행만 필터.
 *
 * 순수 정렬/갭채움 로직은 `aggregate-daily.ts`의 `shapeDailyBuckets`에 위임한다.
 */
export async function aggregateDaily(input: {
  surveyId: string;
  mode: DailyMode;
  /** mode === 'hour' 일 때 필수. 'YYYY-MM-DD' (KST). */
  hourModeDate?: string;
}): Promise<DailyBucket[]> {
  const { surveyId, mode, hourModeDate } = input;

  let rows: DailyRow[];

  if (mode === 'day') {
    rows = await db
      .select({
        bucket: sql<string>`((${surveyResponses.startedAt} AT TIME ZONE 'Asia/Seoul')::date)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(surveyResponses)
      .where(and(eq(surveyResponses.surveyId, surveyId), notDeletedResponse, notTestResponse))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
  } else {
    if (!hourModeDate) {
      throw new Error('aggregateDaily(hour) requires hourModeDate');
    }
    rows = await db
      .select({
        bucket: sql<string>`to_char(date_trunc('hour', ${surveyResponses.startedAt} AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:00')`,
        count: sql<number>`count(*)::int`,
      })
      .from(surveyResponses)
      .where(
        // notDeletedResponse/notTestResponse 와 동일 의미 (AT TIME ZONE 절이 포함된 raw SQL
        // 컨텍스트라 인라인 유지)
        sql`${surveyResponses.surveyId} = ${surveyId} AND (${surveyResponses.startedAt} AT TIME ZONE 'Asia/Seoul')::date = ${hourModeDate}::date AND ${surveyResponses.deletedAt} IS NULL AND ${surveyResponses.isTest} = false`,
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);
  }

  return shapeDailyBuckets(rows, mode, hourModeDate);
}

/**
 * 응답이 존재하는 KST 날짜 목록 ('YYYY-MM-DD'[]) 을 오름차순으로 반환한다.
 * hour 모드의 날짜 선택 드롭다운에 사용 — 비어 있으면 호출 측에서 today 등으로 대체.
 */
export async function aggregateDailyAvailableDates(surveyId: string): Promise<string[]> {
  const rows = await db
    .select({
      day: sql<string>`((${surveyResponses.startedAt} AT TIME ZONE 'Asia/Seoul')::date)::text`,
    })
    .from(surveyResponses)
    .where(and(eq(surveyResponses.surveyId, surveyId), notDeletedResponse, notTestResponse))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return rows.map((r) => r.day);
}
