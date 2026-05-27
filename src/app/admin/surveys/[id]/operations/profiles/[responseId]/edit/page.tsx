import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyVersions } from '@/db/schema';
import { requireSurveyOwnership } from '@/lib/auth/require-survey-ownership';
import { getResponseById } from '@/data/responses';

import { AdminResponseEditor } from './admin-response-editor';

interface PageProps {
  params: Promise<{ id: string; responseId: string }>;
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
export default async function AdminResponseEditPage({ params }: PageProps) {
  const { id: surveyId, responseId } = await params;
  await requireSurveyOwnership(surveyId);

  const response = await getResponseById(responseId, { includeDeleted: true });
  if (!response || response.surveyId !== surveyId) notFound();

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

  // 응답 작성 당시의 questions 스냅샷 로드
  const version = response.versionId
    ? await db.query.surveyVersions.findFirst({
        where: eq(surveyVersions.id, response.versionId),
      })
    : null;

  return (
    <AdminResponseEditor
      surveyId={surveyId}
      responseId={responseId}
      initialResponses={response.questionResponses as Record<string, unknown>}
      versionSnapshot={version?.snapshot ?? null}
      idx={null}
    />
  );
}
