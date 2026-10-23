import { asc, eq, min, sql } from 'drizzle-orm';
import 'server-only';

import { db, type DbOrTx } from '@/db';
import { surveyDocumentAnchors, surveys, surveyVersions } from '@/db/schema';
import { logger } from '@/lib/logger';
import { buildStructureFingerprints } from '@/lib/survey/test-version-fingerprint';
import { toAnchorSnapshot } from '@/server/read-models/anchor-row';
import { getSurveyWithDetails } from '@/server/read-models/survey-structure';
import { extractR2KeysFromJsonbValue } from '@/server/storage-lifecycle/key-extract';
import { recordKeyRefs } from '@/server/storage-lifecycle/key-ref-index';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';

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
 *
 * 스냅샷은 배포와 같은 `buildSurveySnapshot` 으로 만든다 — 테스트 결과가 배포 뒤와 같아야 한다.
 * 배포 번호(max+1)와 겹치지 않게 version_number 는 음수로 내려간다.
 */

const TEST_VERSION_STATUS = 'test';

export interface TestVersion {
  versionId: string;
  snapshot: SurveyVersionSnapshot;
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

/**
 * 지금 저장본의 테스트 버전을 돌려준다 — 저장본이 지금 테스트 버전과 같으면 그것을, 다르면 새로 만들어.
 * 설문이 없으면 null.
 */
export async function ensureTestVersion(surveyId: string): Promise<TestVersion | null> {
  const surveyData = await getSurveyWithDetails(surveyId);
  if (!surveyData) return null;

  const anchorRows = await db
    .select()
    .from(surveyDocumentAnchors)
    .where(eq(surveyDocumentAnchors.surveyId, surveyId))
    .orderBy(asc(surveyDocumentAnchors.order));
  // buildSurveySnapshot 의 결과는 DB 컬럼 타입과 런타임 형태가 같다(배포와 같은 단언 — survey-publish).
  const snapshot = buildSurveySnapshot(
    surveyData,
    anchorRows.map(toAnchorSnapshot),
  ) as SurveyVersionSnapshot;
  const fingerprints = buildStructureFingerprints(snapshot);

  const isSame = (row: Awaited<ReturnType<typeof readCurrentTestVersion>>) =>
    row?.snapshot != null && row.fingerprints?.revision === fingerprints.revision;

  const current = await readCurrentTestVersion(db, surveyId);
  if (current && isSame(current)) {
    return { versionId: current.id, snapshot: current.snapshot as SurveyVersionSnapshot };
  }

  return db.transaction(async (tx) => {
    // 같은 설문의 테스트 버전 만들기를 한 줄로 세운다 — 두 테스터가 동시에 들어와도 하나만 만든다.
    // 이 트랜잭션은 이 잠금 하나만 쥐고 행을 잠그지 않는다(배포 트랜잭션과 잠금 순서가 엇갈리지 않게).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`test-version:${surveyId}`}))`);
    const again = await readCurrentTestVersion(tx, surveyId);
    if (again && isSame(again)) {
      return { versionId: again.id, snapshot: again.snapshot as SurveyVersionSnapshot };
    }

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
        snapshot,
        fingerprints,
      })
      .returning();
    if (!created) throw new Error('ensureTestVersion: 테스트 버전 생성 실패');

    await tx.update(surveys).set({ testVersionId: created.id }).where(eq(surveys.id, surveyId));
    // 불변 소스 인덱스 기록 — 배포와 같다(행 전체, 1회).
    await recordKeyRefs(tx, 'survey_versions', created.id, extractR2KeysFromJsonbValue(created));
    if (again) await pruneVersionSnapshots(tx, [again.id], '테스트 버전 갱신');

    logger.info(
      { surveyId, testVersionId: created.id, previousTestVersionId: again?.id ?? null },
      '[test-version] 저장본으로 테스트 버전을 새로 만들었다',
    );
    return { versionId: created.id, snapshot };
  });
}
