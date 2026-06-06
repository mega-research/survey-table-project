import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { getSurveyWithDetails } from '@/data/surveys';
import { db } from '@/db';
import { surveys, surveyVersions, type SurveyVersionSnapshot } from '@/db/schema';
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

    return newVersion;
  });
}
