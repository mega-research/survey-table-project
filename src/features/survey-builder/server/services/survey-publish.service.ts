import 'server-only';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { getSurveyWithDetails } from '@/data/surveys';
import { db } from '@/db';
import {
  surveyDocumentAnchors,
  surveyResponses,
  surveys,
  surveyVersions,
  type SurveyVersionSnapshot,
} from '@/db/schema';
import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { normalizeQuestions } from '@/lib/question';
import { extractR2KeysFromJsonbValue } from '@/lib/r2-lifecycle/key-extract';
import { recordKeyRefs } from '@/lib/r2-lifecycle/key-ref-index.server';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import { toAnchorSnapshot } from '@/lib/survey-document/anchor-row';
import { assertValidSpssVarNames } from '@/lib/spss/variable-name-guard';
import { buildSurveySnapshot } from '@/lib/versioning/snapshot-builder';
import { pruneVersionSnapshots } from '@/lib/versioning/version-prune.server';
import { findPrunableVersionIds } from '@/lib/versioning/version-retention.server';

import type {
  PublishSurveyInput,
  SurveyVersion,
} from '../../domain/survey-publish';

// ========================
// 설문 배포 (Publish)
// ========================
//
// 인증은 authed 미들웨어가 담당(requireAuth 제거). 캐시 갱신(revalidatePath)은
// 소비처 query invalidation/router refresh 로 대체한다.
// 다인자(surveyId, changeNote?) -> 단일 input object 로 묶음.

export async function publishSurvey(
  input: PublishSurveyInput,
): Promise<SurveyVersion> {
  const { surveyId, changeNote } = input;

  const surveyData = await getSurveyWithDetails(surveyId);
  if (!surveyData) {
    throw new Error('설문을 찾을 수 없습니다.');
  }

  if (!surveyData.questions || surveyData.questions.length === 0) {
    throw new Error('질문이 없는 설문은 배포할 수 없습니다.');
  }

  // 변수명 게이트: 깨진 이름은 배포 단계에서 차단 (export 400보다 앞선 방어선)
  // 주의: export route(raw db.query)와 질문 fetch 경로가 다르지만 검증 체인
  // (normalizeQuestions -> hydrateQuestionsForSpss -> generateSPSSColumns -> assert)은 동일해야 한다.
  // 어느 한쪽 fetch가 질문을 필터링/변형하게 바뀌면 두 게이트가 silent하게 어긋난다.
  // normalizeQuestions(preserve)는 export route 와 동일한 읽기 경계 — 무변형 passthrough.
  assertValidSpssVarNames(
    generateSPSSColumns(hydrateQuestionsForSpss(normalizeQuestions(surveyData.questions))),
  );

  // 앵커는 발행 시점 좌표 그대로 스냅샷에 얼린다 (ADR 0020) — 기존 LUT 사본과 같은 층위.
  // 조사표 파일 참조는 넣지 않는다(라이브). 대상이 지워진 앵커는 FK CASCADE 로 이미 없다.
  const anchorRows = await db
    .select()
    .from(surveyDocumentAnchors)
    .where(eq(surveyDocumentAnchors.surveyId, surveyId))
    .orderBy(asc(surveyDocumentAnchors.order));
  const snapshot = buildSurveySnapshot(surveyData, anchorRows.map(toAnchorSnapshot));

  return await db.transaction(async (tx) => {
    await tx
      .update(surveyVersions)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(surveyVersions.surveyId, surveyId),
          eq(surveyVersions.status, 'published'),
        ),
      );

    const latestVersion = await tx.query.surveyVersions.findFirst({
      where: eq(surveyVersions.surveyId, surveyId),
      orderBy: [desc(surveyVersions.versionNumber)],
      columns: { versionNumber: true },
    });
    const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

    const versionRows = await tx
      .insert(surveyVersions)
      .values({
        surveyId,
        versionNumber: nextVersionNumber,
        status: 'published',
        // buildSurveySnapshot 의 SurveySnapshot 은 DB 컬럼 타입 SurveyVersionSnapshot 과
        // 런타임 형태가 동일하다(차이는 exactOptional 수식자 + lookups 추가 필드뿐, JSONB 직렬화 안전).
        snapshot: snapshot as SurveyVersionSnapshot,
        changeNote: changeNote || null,
      })
      .returning();
    const newVersion = versionRows[0];
    if (!newVersion) throw new Error('publishSurvey: 버전 생성 실패');

    await tx
      .update(surveys)
      .set({
        status: 'published',
        currentVersionId: newVersion.id,
        updatedAt: new Date(),
      })
      .where(eq(surveys.id, surveyId));

    // 불변 소스 인덱스 기록 — 발행 스냅샷은 이후 바뀌지 않으므로 이 1회
    // 추출로 끝난다. 삽입 결과 행이 이미 메모리에 있어 DB 재조회가 없다.
    //
    // 추출 대상은 snapshot 컬럼이 아니라 **행 전체**다. 월 1회 감사
    // (rebuildSource)와 집행 직전 스캔(findReferencedKeys)이 둘 다 행 전체를
    // 훑으므로 — changeNote 같은 자유 텍스트에 들어간 R2 URL 포함 — 여기서
    // snapshot 만 보면 같은 버전이 어느 쓰기 경로를 탔는지에 따라 인덱스
    // 내용이 달라진다. 세 지점이 같은 표면·같은 추출 의미론을 공유한다.
    await recordKeyRefs(
      tx,
      'survey_versions',
      newVersion.id,
      extractR2KeysFromJsonbValue(newVersion),
    );

    // 직전 버전 정리 — 보존 규칙(현재 발행본 OR 살아있는 비테스트 응답)에
    // 미달하는 버전의 snapshot 을 비운다. 이 지점이 있어야 survey_versions
    // 크기가 영구히 묶인다 (일회성 정리만 하면 원위치한다).
    // currentVersionId 갱신을 위에서 이미 했으므로 새 버전은 규칙상 제외되지만,
    // 순서 변경에 견디도록 방어적으로 한 번 더 걸러낸다.
    const prunable = (await findPrunableVersionIds(tx, { surveyId })).filter(
      (id) => id !== newVersion.id,
    );
    if (prunable.length > 0) {
      await pruneVersionSnapshots(tx, prunable, `버전 ${nextVersionNumber} 발행에 따른 정리`);
    }

    return newVersion;
  });
}

/**
 * 배포 확인 안내용 이관 대상 응답 수 (ADR-0014).
 *
 * "진행 중 응답 N건이 새 버전으로 이어집니다" 문구의 N — 해당 설문의
 * 미완료(in_progress·drop) 비테스트·비삭제 응답 수. 재개 시점 이관의 잠재
 * 대상 집계이며, 실제 이관은 응답자 재방문 시점에 일어난다.
 */
export async function countMigratableResponses(input: {
  surveyId: string;
}): Promise<{ count: number }> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, input.surveyId),
        inArray(surveyResponses.status, ['in_progress', 'drop']),
        eq(surveyResponses.isTest, false),
        isNull(surveyResponses.deletedAt),
      ),
    );
  return { count: row?.count ?? 0 };
}
