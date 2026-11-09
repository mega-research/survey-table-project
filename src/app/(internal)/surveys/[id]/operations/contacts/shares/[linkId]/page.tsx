import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ShareEditor } from '@/features/operations/contacts/shares/share-editor';
import { sharesHref } from '@/features/operations/contacts/shares/share-hrefs';
import { requireAdminPage } from '@/lib/auth/require-admin-page';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import {
  getFieldworkShareForEdit,
  loadFieldworkShareFilterContext,
} from '@/server/contacts/services/fieldwork-shares';
import { assertSurveyCapabilityPage } from '@/server/page-survey-access';

export const metadata: Metadata = {
  title: '현황 - 외주 담당 범위 수정',
};

interface PageProps {
  params: Promise<{ id: string; linkId: string }>;
}

/**
 * 외주 링크 하나의 담당 범위 수정 — 컨택원 수정 화면과 같은 손 모양(조건 편집기 · 오른쪽 대상 목록 ·
 * 미리보기 · 적용). 다시 열면 마지막으로 적용한 조건이 채워진다. 관문은 링크 발급과 같은 `survey.manageAccess`.
 * 이 설문의 열린 외주 링크가 아니면(종료됐거나 다른 설문·클라이언트 링크) 404 다.
 */
export default async function FieldworkShareEditPage({ params }: PageProps) {
  const { id: surveyId, linkId } = await params;
  const viewer = await requireAdminPage();
  await assertSurveyCapabilityPage(viewer, surveyId, 'survey.manageAccess');

  // 적용이 조건을 해석하는 것과 같은 컨텍스트 — 후보·결과코드가 서버 해석과 같다(컨택원 열은 없다).
  const [link, filterCtx] = await Promise.all([
    getFieldworkShareForEdit(surveyId, linkId),
    loadFieldworkShareFilterContext(surveyId),
  ]);
  if (!link) notFound();
  const { scheme, resultCodes } = filterCtx;

  // 「전체」 부분검색은 범위 조건으로 쓰지 않는다 — 어느 열에서 걸렸는지 설명할 수 없다.
  const columnCandidates = filterCtx.columnCandidates.filter((c) => c.source !== FILTER_SOURCE.ALL);

  const firstAttrs = (scheme?.columns ?? [])
    .filter((c) => !c.hidden && c.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX))
    .sort((a, b) => a.order - b.order)[0];
  const displayColumn = firstAttrs ? { source: firstAttrs.source, label: firstAttrs.label } : null;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <nav className="mb-2 flex items-center gap-2 text-sm" aria-label="경로">
        <Link href={sharesHref(surveyId)} className="text-blue-600 hover:underline">
          외주 담당 범위
        </Link>
        <span className="text-slate-400">›</span>
        <span className="text-slate-600">{link.name}</span>
      </nav>
      <h2 className="mb-4 text-xl font-bold text-gray-900">{link.name} 담당 범위</h2>
      <ShareEditor
        surveyId={surveyId}
        link={{
          id: link.linkId,
          name: link.name,
          divided: link.divided,
          count: link.count,
          lastClauses: link.lastClauses,
        }}
        columnCandidates={columnCandidates}
        resultCodeOptions={resultCodes}
        displayColumn={displayColumn}
      />
    </main>
  );
}
