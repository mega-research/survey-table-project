import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { getSurveyWithDetails } from '@/data/surveys';
import { db } from '@/db';
import { surveys, surveyVersions, type SurveyVersionSnapshot } from '@/db/schema';
import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { normalizeQuestions } from '@/lib/question';
import { extractR2KeysFromJsonbValue } from '@/lib/r2-lifecycle/key-extract';
import { recordKeyRefs } from '@/lib/r2-lifecycle/key-ref-index.server';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
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

  const snapshot = buildSurveySnapshot(surveyData);

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
    // 추출로 끝난다. 스냅샷이 이미 메모리에 있어 DB 재조회가 없다.
    await recordKeyRefs(
      tx,
      'survey_versions',
      newVersion.id,
      extractR2KeysFromJsonbValue(snapshot),
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
