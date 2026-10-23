import { and, asc, eq, min, ne, sql } from 'drizzle-orm';
import 'server-only';

import { db, type DbOrTx } from '@/db';
import { surveyDocumentAnchors, surveyResponses, surveys, surveyVersions } from '@/db/schema';
import { logger } from '@/lib/logger';
import { buildStructureFingerprints } from '@/lib/survey/test-version-fingerprint';
import { toAnchorSnapshot } from '@/server/read-models/anchor-row';
import { getSurveyWithDetails } from '@/server/read-models/survey-structure';
import { extractR2KeysFromJsonbValue } from '@/server/storage-lifecycle/key-extract';
import { recordKeyRefs } from '@/server/storage-lifecycle/key-ref-index';
import {
  TEST_VERSION_STATUS,
  type SurveyVersionFingerprints,
  type SurveyVersionSnapshot,
} from '@/shared/contracts/survey';

import { buildSurveySnapshot } from './versioning/snapshot-builder';
import { pruneVersionSnapshots } from './versioning/version-prune';

/**
 * 테스트 버전 (CONTEXT.md 「테스트 버전」) — 테스트 링크 · 테스트 대상자 링크 · 관리자 미리보기가 보는,
 * 지금 저장본으로 만든 스냅샷. 저장만으로 끝까지 테스트하고 실응답 링크는 배포본에 둔다.
 *
 * 테스트 화면에 **들어오는 순간** 저장본으로 스냅샷을 만들어 지금 테스트 버전과 리비전을 비교하고,
 * 다르면 새 테스트 버전 행을 만든다(저장 경로마다 장치를 달지 않는다 — 들어오는 자리 한 곳).
 * 행은 배포 스냅샷처럼 불변이고, 새로 만들 때 직전 테스트 버전의 snapshot 을 비운다 — 남는 스냅샷은
 * 최신 하나. 버전 id 가 바뀌는 것만으로 무중단 갈아타기 · 재개 이관 · 「스냅샷이 비워진 버전의 테스트
 * 응답」 안내(테스트 중 저장되면 다음 저장이 멈추고 새로고침하면 바뀐 곳부터 이어진다)가 그대로 돈다.
 * 지문(`fingerprints`)은 snapshot 을 비워도 남겨 다음 버전으로 옮길 때 「바뀐 문항」을 가른다.
 * 아무 응답도 가리키지 않는 옛 테스트 버전 행은 지운다 — 진입마다 행이 쌓이지 않게.
 *
 * 스냅샷은 배포와 같은 `buildSurveySnapshot` 으로 만든다 — 테스트 결과가 배포 뒤와 같아야 한다.
 * 배포 번호(max+1)와 겹치지 않게 version_number 는 음수로 내려간다.
 */

export interface TestVersion {
  versionId: string;
  snapshot: SurveyVersionSnapshot;
}

interface LiveSnapshot {
  snapshot: SurveyVersionSnapshot;
  fingerprints: SurveyVersionFingerprints;
}

/** 지금 저장본의 스냅샷과 지문. 설문이 없으면 null. */
async function buildLiveSnapshot(executor: DbOrTx, surveyId: string): Promise<LiveSnapshot | null> {
  const surveyData = await getSurveyWithDetails(surveyId);
  if (!surveyData) return null;
  const anchorRows = await executor
    .select()
    .from(surveyDocumentAnchors)
    .where(eq(surveyDocumentAnchors.surveyId, surveyId))
    .orderBy(asc(surveyDocumentAnchors.order));
  // buildSurveySnapshot 의 결과는 DB 컬럼 타입과 런타임 형태가 같다(배포와 같은 단언 — survey-publish).
  const snapshot = buildSurveySnapshot(
    surveyData,
    anchorRows.map(toAnchorSnapshot),
  ) as SurveyVersionSnapshot;
  return { snapshot, fingerprints: buildStructureFingerprints(snapshot) };
}

async function readCurrentTestVersion(executor: DbOrTx, surveyId: string) {
  const [row] = await executor
    .select({
      id: surveyVersions.id,
      snapshot: surveyVersions.snapshot,
      fingerprints: surveyVersions.fingerprints,
    })
    .from(surveys)
    .innerJoin(surveyVersions, eq(surveyVersions.id, surveys.testVersionId))
    .where(eq(surveys.id, surveyId))
    .limit(1);
  return row ?? null;
}

function sameAs(
  row: Awaited<ReturnType<typeof readCurrentTestVersion>>,
  live: LiveSnapshot,
): row is NonNullable<typeof row> & { snapshot: SurveyVersionSnapshot } {
  return row?.snapshot != null && row.fingerprints?.revision === live.fingerprints.revision;
}

/**
 * 지금 저장본의 테스트 버전을 돌려준다 — 저장본이 지금 테스트 버전과 같으면 그것을, 다르면 새로 만들어.
 * 설문이 없으면 null.
 */
export async function ensureTestVersion(surveyId: string): Promise<TestVersion | null> {
  // 잠금 없이 먼저 본다 — 저장본이 그대로인 흔한 진입은 쓰기 없이 끝난다.
  const probe = await buildLiveSnapshot(db, surveyId);
  if (!probe) return null;
  const current = await readCurrentTestVersion(db, surveyId);
  if (sameAs(current, probe)) return { versionId: current.id, snapshot: current.snapshot };

  return db.transaction(async (tx) => {
    // 같은 설문의 테스트 버전 만들기를 한 줄로 세운다. 스냅샷은 **잠금을 쥔 뒤 다시** 만든다 — 잠금 밖에서
    // 만든 것을 쓰면, 저장 전 상태를 읽은 진입이 저장 후 진입보다 늦게 잠금을 얻어 낡은 저장본으로 최신
    // 테스트 버전을 덮는다. 잠금을 쥔 뒤의 진입은 그 앞 진입이 커밋한 결과와 그 시점의 저장본을 본다.
    // 쓰는 행은 surveys 한 줄(포인터)과 survey_versions(새 행 · 직전 행) — 배포 트랜잭션(published 행 →
    // surveys 행 → 정리 대상)과 겹치는 것은 surveys 행뿐이고, 지금 테스트 버전은 배포 정리에서 빠진다.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`test-version:${surveyId}`}))`);
    const live = await buildLiveSnapshot(tx, surveyId);
    if (!live) return null;
    const again = await readCurrentTestVersion(tx, surveyId);
    if (sameAs(again, live)) return { versionId: again.id, snapshot: again.snapshot };

    const [lowest] = await tx
      .select({ value: min(surveyVersions.versionNumber) })
      .from(surveyVersions)
      .where(eq(surveyVersions.surveyId, surveyId));
    const versionNumber = Math.min(lowest?.value ?? 0, 0) - 1;

    const [created] = await tx
      .insert(surveyVersions)
      .values({
        surveyId,
        versionNumber,
        status: TEST_VERSION_STATUS,
        snapshot: live.snapshot,
        fingerprints: live.fingerprints,
      })
      .returning();
    if (!created) throw new Error('ensureTestVersion: 테스트 버전 생성 실패');

    await tx.update(surveys).set({ testVersionId: created.id }).where(eq(surveys.id, surveyId));
    // 불변 소스 인덱스 기록 — 배포와 같다(행 전체, 1회).
    const createdKeys = extractR2KeysFromJsonbValue(created);
    await recordKeyRefs(tx, 'survey_versions', created.id, createdKeys);
    if (again) {
      // 새 스냅샷이 여전히 참조하는 키는 유예 삭제에 올리지 않는다 — 진입마다 「보존됨」 잡음이 되지 않게.
      await pruneVersionSnapshots(tx, [again.id], '테스트 버전 갱신', {
        keepKeys: new Set(createdKeys),
      });
    }
    await deleteUnreferencedTestVersions(tx, surveyId, created.id);

    logger.info(
      { surveyId, testVersionId: created.id, previousTestVersionId: again?.id ?? null },
      '[test-version] 저장본으로 테스트 버전을 새로 만들었다',
    );
    return { versionId: created.id, snapshot: live.snapshot };
  });
}

/**
 * 아무 응답도 가리키지 않는 옛 테스트 버전 행을 지운다. 응답이 가리키는 행(그 응답을 다음 버전으로 옮길 때
 * 지문이 필요하다)과 이관 출처로 남은 행은 둔다. 스냅샷이 비워진 행만 대상이라 R2 참조는 이미 해제됐다.
 */
async function deleteUnreferencedTestVersions(
  tx: DbOrTx,
  surveyId: string,
  keepId: string,
): Promise<void> {
  await tx.delete(surveyVersions).where(
    and(
      eq(surveyVersions.surveyId, surveyId),
      eq(surveyVersions.status, TEST_VERSION_STATUS),
      ne(surveyVersions.id, keepId),
      sql`${surveyVersions.snapshot} is null`,
      sql`not exists (
        select 1 from ${surveyResponses} r
        where r.survey_id = ${surveyId}
          and (r.version_id = ${surveyVersions.id}
            or r.metadata->>'migratedFromVersionId' = ${surveyVersions.id}::text)
      )`,
    ),
  );
}

