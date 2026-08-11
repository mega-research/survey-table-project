import 'server-only';

import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { surveyResponses, surveys, surveyVersions } from '@/db/schema';
import type { R2DbExecutor } from '@/lib/r2-lifecycle/deletion-queue.server';

/**
 * 정리 대상 버전 id 목록. version-retention.ts 의 isVersionPrunable 과 같은
 * 규칙을 SQL 로 표현한다 — 규칙 변경 시 양쪽을 함께 바꾼다.
 *
 * surveyId 를 주면 해당 설문으로 한정한다 (발행 시점 정리용).
 */
export async function findPrunableVersionIds(
  dbc: R2DbExecutor,
  options: { surveyId?: string } = {},
): Promise<string[]> {
  const rows = await dbc
    .select({ id: surveyVersions.id })
    .from(surveyVersions)
    .leftJoin(surveys, eq(surveys.id, surveyVersions.surveyId))
    .where(
      and(
        // 이미 정리된 버전 제외
        isNotNull(surveyVersions.snapshot),
        options.surveyId ? eq(surveyVersions.surveyId, options.surveyId) : undefined,
        // 현재 발행본 제외 (currentVersionId 가 NULL 이어도 안전하도록 is distinct from)
        sql`${surveys.currentVersionId} is distinct from ${surveyVersions.id}`,
        // 살아있는 비테스트 응답 보유 제외
        sql`not exists (
          select 1 from ${surveyResponses} r
          where r.version_id = ${surveyVersions.id}
            and r.is_test = false
            and r.deleted_at is null
        )`,
      ),
    );
  return rows.map((row) => row.id);
}
