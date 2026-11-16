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

import { buildSurveySnapshot } from '@/server/survey-builder/services/versioning/snapshot-builder';
import { pruneVersionSnapshots } from '@/server/survey-builder/services/versioning/version-prune';
import { InternalFailure } from '@/server/internal-failure';

/**
 * 테스트 버전 (CONTEXT.md 「테스트 버전」) — 테스트 링크 · 테스트 대상자 링크 · 관리자 미리보기가 보는,
 * 지금 저장본으로 만든 스냅샷. 저장만으로 끝까지 테스트하고 실응답 링크는 배포본에 둔다.
 *
 * 테스트 화면에 들어올 때와 **테스트 응답을 저장할 때마다**(답 저장 · 임시 저장 · 제출) 저장본으로
 * 스냅샷을 만들어 지금 테스트 버전과 리비전을 비교하고, 다르면 새 테스트 버전 행을 만든다 — 빌더의
 * 저장 경로(문항 · 그룹 · 참조표 · 조사표 앵커 …)마다 장치를 달지 않고, 테스트 쪽에서 본다.
 * 그래서 빌더에서 저장만 해도 진행 중인 테스터의 다음 저장이 멈춘다(배포했을 때와 같다).
 * 빌더(진입)와 응답(저장) 두 도메인이 부르므로 workflows 에 둔다.
 * 행은 배포 스냅샷처럼 불변이고, 새로 만들 때 직전 테스트 버전의 snapshot 을 비운다 — 남는 스냅샷은
 * 최신 하나. 버전 id 가 바뀌는 것만으로 무중단 갈아타기 · 재개 이관 · 「스냅샷이 비워진 버전의 테스트
 * 응답」 안내(테스트 중 저장되면 다음 저장이 멈추고 새로고침하면 바뀐 곳부터 이어진다)가 그대로 돈다.
 * 지문(`fingerprints`)은 snapshot 을 비워도 남겨 다음 버전으로 옮길 때 「바뀐 문항」을 가른다.
 * 아무 응답도 가리키지 않는 옛 테스트 버전 행은 지운다 — 진입마다 행이 쌓이지 않게.
 *
 * 스냅샷은 배포와 같은 `buildSurveySnapshot` 으로 만든다 — 테스트 결과가 배포 뒤와 같아야 한다.
 * 배포 번호(max+1)와 겹치지 않게 version_number 는 음수로 내려간다.
 *
 * ── 배선과 규칙 ──
 * - **테스트 버전**(2026-10-23, 0141): 테스트 링크 · 테스트 대상자 링크 · 관리자
 *   미리보기(`/admin/surveys/[id]/preview`)는 배포본이 아니라 **저장본으로 만든 스냅샷**을 본다 — 저장만으로
 *   응답 확정 · 자격미달 · 종료 이동 · Raw 내보내기까지 테스트하고, 실응답 링크와 공개 미리보기는 배포본
 *   그대로다.
 * - 한 번도 배포하지 않은 설문도 테스트 버전이 생긴다.
 * - `server/workflows/test-version.ts` 의 `ensureTestVersion` 이 테스트 화면에 들어올 때(`getSurveyForResponse`
 *   의 유효 테스트 세션 · `useTestVersion` · 테스트 응답의 관리자 수정 화면)와 **테스트 응답을 저장할
 *   때마다**(`syncTestVersionBeforeWrite` — 답 저장 · 임시 저장 · 제출, 실응답은 건너뜀) 저장본 스냅샷(배포와
 *   같은 `buildSurveySnapshot`)의 리비전을 지금 테스트 버전과 비교해, 다르면 `survey_versions` 에
 *   `status='test'`·음수 번호 행을 **새로 만들고** `surveys.test_version_id` 를 옮기고 직전 테스트 버전의
 *   snapshot 을 비운다(`pruneVersionSnapshots`, 설문당 advisory lock 으로 한 줄 세움).
 * - 행은 배포 스냅샷처럼 불변이라 R2 참조는 만들 때 한 번 기록한다.
 * - 빌더 저장 경로마다 장치를 달지 않고 테스트 쪽에서 본다 — 그래서 빌더에서 저장만 해도 진행 중인 테스터의
 *   다음 저장이 멈춘다(배포와 같다).
 * - 빌더·응답 두 도메인이 부르므로 workflows 에 있다.
 * - 비용은 테스트 응답 저장마다 저장본 스냅샷을 한 번 만드는 것이다(실응답 무관).
 * - 테스트 응답이 보는 버전은 `testVersionId ?? currentVersionId` 다(`shared/contracts/survey` 의
 *   `pinnedVersionId` — **테스트는 테스트 버전에만 있다**) — 생성(`loadValidatedVersionGateRow` 의 `{ isTest }`
 *   — 실응답이 테스트 버전 id 를 보내도 배포본으로 재핀) · 테스트 대상자(`acquireTestTargetResponse`) · 재개
 *   이관(`lifecycle.ts` 의 `resumeTargetVersionId`) · 관리자 응답 수정(렌더 버전과 `saveAdminEdit` 의 낙관 버전
 *   가드) · 테스트 대상자에게 보내는 개인정보 열(`lookupContactAttrs`) · 테스트 파티션 집계(이탈 퍼널 · 페이지
 *   체류 · 수요 집계 — `read-models/version-snapshot` 의 `loadPinnedVersionSnapshot`).
 * - 버전 id 가 바뀌는 것만으로 기존 장치가 돈다: 테스트 중 저장본이 바뀌면 옛 테스트 버전 위의 답 저장 · 임시
 *   저장 · 제출(빈 complete 포함)이 `TEST_VERSION_REPUBLISHED`(「설문이 수정되었습니다 — 새로고침하면 바뀐
 *   곳부터 이어집니다」)로 멈추고, 새로고침하면 재개 이관이 구조 생존 판정으로 답을 거르고 **바뀐 문항**(지문
 *   비교 `lib/survey/test-version-fingerprint` 의 `changedQuestionIds` — 문구·조건 포함, 새 문항, 설정이 바뀐
 *   그룹과 하위 그룹의 문항, 순서만 바뀐 것은 제외)과 지운 문항 중 가장 앞 페이지로 데려간다.
 * - 실응답 이관은 지문이 없어 종전과 같다.
 * - 배포 번호(`Math.max(최신, 0) + 1`) · 버전 목록(`getSurveyVersions` 두 벌) · 보존
 *   정리(`findPrunableVersionIds` — 지금 테스트 버전 제외)는 테스트 버전을 뺀다.
 * - 테스트 응답으로 쿼터를 확인하는 것은 여전히 안 된다(테스트 응답은 쿼터 계산에서 빠진다).
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
    if (!created) throw new InternalFailure('ensureTestVersion: 테스트 버전 생성 실패');

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

