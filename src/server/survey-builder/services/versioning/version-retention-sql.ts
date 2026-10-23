import 'server-only';

import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { responseMigrationHistory, surveyResponses, surveys, surveyVersions } from '@/db/schema';
import type { R2DbExecutor } from '@/server/storage-lifecycle/deletion-queue';

/**
 * 정리 대상 버전 id 목록. version-retention.ts 의 isVersionPrunable 과 같은
 * 규칙을 SQL 로 표현한다 — 규칙 변경 시 양쪽을 함께 바꾼다.
 *
 * prunable = snapshot 있음 AND 현재 발행본 아님 AND 지금 테스트 버전 아님
 *   AND 비테스트 응답 없음 (version_id 참조 — 휴지통 응답 포함, 되살릴 수 있으므로)
 *   AND 이관 출처 참조 없음 (metadata->>'migratedFromVersionId', ADR-0014 — 휴지통 포함)
 *   AND 이관 이력 참조 없음 (response_migration_history from/to, 0142)
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
        // 지금 테스트 버전 제외 (0141) — 테스트 화면이 보는 저장본 스냅샷이다. 직전 테스트 버전은
        // 만들 때 이미 비운다(test-version).
        sql`${surveys.testVersionId} is distinct from ${surveyVersions.id}`,
        // 비테스트 응답 보유 제외 — 휴지통 응답도 센다(되살리면 이 구조로 읽어야 한다).
        sql`not exists (
          select 1 from ${surveyResponses} r
          where r.version_id = ${surveyVersions.id}
            and r.is_test = false
        )`,
        // 이관 출처로 참조되는 버전 제외 (ADR-0014) — 재핀으로 version_id 참조를
        // 잃어도 metadata 의 migratedFromVersionId 가 가리키는 스냅샷은 보존한다.
        // uuid ↔ text 비교이므로 id 를 text 로 캐스트한다.
        sql`not exists (
          select 1 from ${surveyResponses} r
          where r.metadata->>'migratedFromVersionId' = ${surveyVersions.id}::text
            and r.is_test = false
        )`,
        // 이관 이력이 옮기기 전·후로 가리키는 버전 제외 (0142). 이력은 실응답만 남긴다.
        sql`not exists (
          select 1 from ${responseMigrationHistory} h
          where h.from_version_id = ${surveyVersions.id}
             or h.to_version_id = ${surveyVersions.id}
        )`,
      ),
    );
  return rows.map((row) => row.id);
}
