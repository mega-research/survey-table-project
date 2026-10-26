import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { notDeletedResponse } from '@/server/response-filters';

import {
  FIELDWORK_ABSORBED_STATUSES,
  mapRowsToCounts,
  type StatusCounts,
} from '@/lib/operations/aggregate-status-format';
import { responseScopeCondition, testFlagForScope, type OperationsDataScope } from '@/server/data-scope';
import {
  getFieldworkCompletedCounts,
  isFieldworkCompletedSql,
} from '@/server/read-models/fieldwork-completions';
import { getResultCodeStatuses } from '@/server/read-models/result-code-statuses';

/**
 * 단일 설문의 응답 상태 집계를 반환한다 (서버 전용).
 * 행이 없는 설문은 모든 필드가 0인 객체를 반환한다 (renderer가 empty 처리).
 *
 * 순수 변환 로직은 `aggregate-status.ts`의 `mapRowsToCounts`에 분리되어 있어
 * 단위 테스트에서 db mock 없이 검증한다.
 *
 * 실사 완료 처리(조사 대상 수)를 함께 세어 전체에 더한다. 그 사람들의 쿼터마감·불량·이탈 행은
 * `fieldworkCompleted` 표식을 달아 돌려주고 `mapRowsToCounts` 가 자기 버킷에서 뺀다.
 */
export async function aggregateStatus(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<StatusCounts> {
  const isTest = testFlagForScope(scope);
  const { positive } = await getResultCodeStatuses(surveyId);
  const absorbedStatuses = sql.join(
    FIELDWORK_ABSORBED_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const fieldworkCompleted = sql<boolean>`(
    ${surveyResponses.status} IN (${absorbedStatuses})
    AND ${surveyResponses.contactTargetId} IS NOT NULL
    AND ${isFieldworkCompletedSql(sql`${surveyResponses.contactTargetId}`, positive, isTest)}
  )`;

  const [rows, fieldworkCounts] = await Promise.all([
    db
      .select({
        status: surveyResponses.status,
        fieldworkCompleted,
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
      // 표식 식은 바인딩 파라미터를 품어 SELECT·GROUP BY 에 따로 바인딩되면 PG 가 같은 식으로 보지 못한다 — 열 번호로 묶는다
      .groupBy(sql.raw('1'), sql.raw('2')),
    getFieldworkCompletedCounts([surveyId], isTest),
  ]);

  return mapRowsToCounts(rows, fieldworkCounts.get(surveyId) ?? 0);
}
