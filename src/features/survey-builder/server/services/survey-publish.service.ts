import 'server-only';

import { and, desc, eq, ne, notExists, sql } from 'drizzle-orm';

import { getSurveyWithDetails } from '@/data/surveys';
import { db } from '@/db';
import {
  surveyResponses,
  surveys,
  surveyVersions,
  type SurveyVersionSnapshot,
} from '@/db/schema';
import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { normalizeQuestions } from '@/lib/question';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import { assertValidSpssVarNames } from '@/lib/spss/variable-name-guard';
import { buildSurveySnapshot } from '@/lib/versioning/snapshot-builder';

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

    // 응답이 참조하지 않는 이전 버전 스냅샷 정리 — 스냅샷(~수백 KB/개)이 publish
    // 마다 쌓여 DB 를 잠식하는 것을 막는다. 응답이 있는 버전은 응답 수정 재계산·
    // 운영 집계·이전 버전 진행 중 응답 검증이 스냅샷을 읽으므로 보존해야 하고,
    // 방금 만든 버전이 항상 남으므로 versionNumber 는 재사용 없이 단조 증가한다.
    await tx.delete(surveyVersions).where(
      and(
        eq(surveyVersions.surveyId, surveyId),
        ne(surveyVersions.id, newVersion.id),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(surveyResponses)
            .where(eq(surveyResponses.versionId, surveyVersions.id)),
        ),
      ),
    );

    return newVersion;
  });
}
