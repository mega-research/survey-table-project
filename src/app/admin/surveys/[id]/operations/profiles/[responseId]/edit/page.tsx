import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveys, surveyVersions } from '@/db/schema';
import { requireSurveyOwnership } from '@/lib/auth/require-survey-ownership';
import { getResponseById } from '@/server/read-models/responses';
import { isResponseExcluded } from '@/server/operations/services/profiles.server';
import { getOperationsDataScope, testFlagForScope } from '@/server/data-scope.server';
import { applyStructuralSurvival } from '@/lib/survey-response/structural-survival';
import { normalizeQuestions } from '@/lib/question/normalize';
import { toFlatQuestion } from '@/lib/question/variants';

import { AdminResponseEditor } from './admin-response-editor';

interface PageProps {
  params: Promise<{ id: string; responseId: string }>;
  searchParams: Promise<{ idx?: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 수정' };

/**
 * 어드민 응답 수정 라우트.
 *
 * - requireSurveyOwnership 가 인증 + 설문 존재 가드.
 * - getResponseById 로 응답 조회 (soft delete 포함).
 *   - 삭제된 응답이면 안내 화면 (복원 안내).
 *   - 응답 surveyId 가 path 와 다르면 notFound.
 * - 렌더 버전은 항상 현재 배포 버전(surveys.currentVersionId) 스냅샷 — 미배포 설문만
 *   응답 자신의 버전으로 폴백한다(스펙 결정 1). 응답 버전과 렌더 버전이 다르면
 *   구조 생존 필터(applyStructuralSurvival)로 프리필하고 배너를 띄운다(스펙 결정 2·3).
 *   렌더만으로는 DB 를 바꾸지 않는다 — 실제 이관은 저장 시점에 service 가 수행한다.
 */
export default async function AdminResponseEditPage({ params, searchParams }: PageProps) {
  const { id: surveyId, responseId } = await params;
  const sp = await searchParams;
  const idxNum = sp.idx ? parseInt(sp.idx, 10) : NaN;
  const idx = Number.isFinite(idxNum) && idxNum > 0 ? idxNum : null;
  await requireSurveyOwnership(surveyId);
  const scope = await getOperationsDataScope(surveyId);

  const response = await getResponseById(responseId, { includeDeleted: true });
  if (
    !response ||
    response.surveyId !== surveyId ||
    response.isTest !== testFlagForScope(scope)
  ) {
    notFound();
  }

  if (response.deletedAt !== null) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <h1 className="text-xl font-bold">삭제된 응답입니다</h1>
        <p className="mt-2 text-sm text-slate-500">
          이 응답은 휴지통에 있습니다. 응답 내역에서 복원한 뒤 다시 시도하세요.
        </p>
      </main>
    );
  }

  // 렌더 버전 결정 (스펙 결정 1): 항상 현재 배포 버전 스냅샷. 미배포 설문만 응답
  // 자신의 버전으로 폴백(기존 동작). 레거시 versionId null 응답도 최신으로 렌더한다.
  const surveyRow = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { currentVersionId: true },
  });
  const renderVersionId = surveyRow?.currentVersionId ?? response.versionId ?? null;

  // 렌더 버전 스냅샷과 contact attrs, negative 제외 여부를 병렬로 조회.
  const [version, contactRow, excluded] = await Promise.all([
    renderVersionId
      ? db.query.surveyVersions.findFirst({
          where: eq(surveyVersions.id, renderVersionId),
        })
      : Promise.resolve(null),
    response.contactTargetId
      ? db.query.contactTargets.findFirst({
          where: and(
            eq(contactTargets.id, response.contactTargetId),
            eq(contactTargets.surveyId, surveyId),
            eq(contactTargets.isTest, testFlagForScope(scope)),
          ),
          columns: { attrs: true },
        })
      : Promise.resolve(null),
    isResponseExcluded(surveyId, responseId, scope),
  ]);
  // contactTargetId 가 없으면 익명 응답이므로 빈 객체.
  const contactAttrs = contactRow?.attrs ?? {};

  // 구버전 응답을 최신 형식으로 열 때: 같은 구조만 프리필, 다른 구조는 비움 (스펙 결정 2).
  // 렌더만으로는 DB 를 바꾸지 않는다 — 저장 시점에 service 가 이관한다.
  const migratedFromOldVersion =
    surveyRow?.currentVersionId != null && response.versionId !== surveyRow.currentVersionId;
  let initialResponses = response.questionResponses as Record<string, unknown>;
  if (migratedFromOldVersion) {
    // SurveyVersionSnapshot.questions 는 타입상 필수지만 손상된 스냅샷 행은 방어적으로
    // 읽는다(response-edit.service.ts 161-175행과 동일 캐스팅 패턴).
    const rawSnapshot = version?.snapshot as unknown as { questions?: unknown } | null;
    if (Array.isArray(rawSnapshot?.questions)) {
      const snapshotQuestions = normalizeQuestions(rawSnapshot.questions, 'preserve').map(
        toFlatQuestion,
      );
      initialResponses = applyStructuralSurvival(
        initialResponses,
        snapshotQuestions,
      ).survivingResponses;
    }
  }

  return (
    <>
      {excluded && (
        <div
          role="status"
          className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-900"
        >
          이 응답자는 부정 결과코드로 모집단에서 제외된 상태입니다. 응답률·메일·응답 페이지에서 가려져 있습니다.
        </div>
      )}
      <AdminResponseEditor
        surveyId={surveyId}
        responseId={responseId}
        initialResponses={initialResponses}
        versionSnapshot={version?.snapshot ?? null}
        initialContactAttrs={contactAttrs}
        idx={idx}
        renderedVersionId={surveyRow?.currentVersionId ?? null}
        migratedFromOldVersion={migratedFromOldVersion}
      />
    </>
  );
}
