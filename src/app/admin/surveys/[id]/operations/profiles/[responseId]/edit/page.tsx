import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveyVersions } from '@/db/schema';
import { requireSurveyOwnership } from '@/lib/auth/require-survey-ownership';
import { getResponseById } from '@/data/responses';
import { isResponseExcluded } from '@/lib/operations/profiles.server';
import { getOperationsDataScope, testFlagForScope } from '@/lib/operations/data-scope.server';

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
 * - 응답 작성 당시의 versionSnapshot 을 로드해 AdminResponseEditor 에 전달.
 *   snapshot 미존재 (미배포 응답) 인 경우 null — flow 가 fallback 으로 처리.
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

  // 응답 작성 당시의 스냅샷과 contact attrs, negative 제외 여부를 병렬로 조회.
  const [version, contactRow, excluded] = await Promise.all([
    response.versionId
      ? db.query.surveyVersions.findFirst({
          where: eq(surveyVersions.id, response.versionId),
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
        initialResponses={response.questionResponses as Record<string, unknown>}
        versionSnapshot={version?.snapshot ?? null}
        initialContactAttrs={contactAttrs}
        idx={idx}
      />
    </>
  );
}
