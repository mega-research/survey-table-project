import 'server-only';

import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';

import {
  shapeResponseTime,
  type Platform,
  type ResponseTimeRow,
} from './response-time';

/**
 * 단일 설문의 응답시간 통계 4행 표를 반환한다 (서버 전용).
 *
 * - DB 컬럼 `platform`은 plain text. 값 도메인('desktop'|'mobile'|'tablet')은
 *   T4 단계의 INSERT 측에서 보장하므로 어댑터에서는 그대로 통과시킨다.
 * - `total_seconds IS NULL` 행은 SQL 단계에서 사전 제외 (불필요한 전송 방지).
 * - 평균/트리밍/min/max 등 통계는 순수 함수 `shapeResponseTime`에 위임.
 */
export async function getResponseTime(surveyId: string): Promise<ResponseTimeRow[]> {
  const rows = await db
    .select({
      platform: surveyResponses.platform,
      totalSeconds: surveyResponses.totalSeconds,
    })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        isNotNull(surveyResponses.totalSeconds),
        isNull(surveyResponses.deletedAt),
      ),
    );

  // platform 컬럼은 text(nullable). Platform 유니언으로 캐스팅 — 도메인 보장은 INSERT 측 책임.
  return shapeResponseTime(
    rows as Array<{ platform: Platform | null; totalSeconds: number | null }>,
  );
}
