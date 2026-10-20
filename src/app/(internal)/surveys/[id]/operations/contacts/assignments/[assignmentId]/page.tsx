import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AssignmentEditor } from '@/features/operations/contacts/assignments/assignment-editor';
import { assignmentsHref } from '@/features/operations/contacts/assignments/assignment-hrefs';
import { requireAdminPage } from '@/lib/auth/require-admin-page';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { getAssignmentForEdit } from '@/server/contacts/services/contact-assignments';
import { getOperationsDataScope } from '@/server/data-scope';
import { assertSurveyCapabilityPage } from '@/server/page-survey-access';
import { loadContactFilterContext } from '@/server/read-models/contact-filter-resolution';

export const metadata: Metadata = {
  title: '현황 - 컨택원 수정',
};

interface PageProps {
  params: Promise<{ id: string; assignmentId: string }>;
}

/**
 * 컨택원 수정 (시안 C) — 이름과 배정할 대상 조건을 정하고 교체 적용한다.
 * 다시 열면 마지막으로 적용한 조건이 채워진다. 외부 주체에게는 없다.
 */
export default async function ContactAssignmentEditPage({ params }: PageProps) {
  const { id: surveyId, assignmentId } = await params;
  // 내부 실사 운영 도구 — 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않으므로 페이지가 스스로
  // 막는다. 컨택원 배정은 명단 관리 표면이라 contacts.manage 관문을 지난다(외부 주체에게는 없는 권한).
  const viewer = await requireAdminPage();
  await assertSurveyCapabilityPage(viewer, surveyId, 'contacts.manage');
  const scope = await getOperationsDataScope(surveyId);

  // 교체 적용이 조건을 해석하는 것과 같은 컨텍스트 — 후보·결과코드·컨택원이 서버 해석과 같다.
  const [assignment, filterCtx] = await Promise.all([
    getAssignmentForEdit(surveyId, scope, assignmentId),
    loadContactFilterContext(surveyId, scope, { isExternal: false, surface: 'contacts' }),
  ]);
  if (!assignment) notFound();
  const { scheme, resultCodes, assignmentOptions } = filterCtx;

  // 「전체」 부분검색은 배정 조건으로 쓰지 않는다 — 어느 열에서 걸렸는지 설명할 수 없다.
  const columnCandidates = filterCtx.columnCandidates.filter(
    (c) => c.source !== FILTER_SOURCE.ALL,
  );

  // 오른쪽 대상 목록 두 번째 열 — 표시 중인 첫 attrs 열 (기업명 등).
  const firstAttrs = (scheme?.columns ?? [])
    .filter((c) => !c.hidden && c.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX))
    .sort((a, b) => a.order - b.order)[0];
  const displayColumn = firstAttrs ? { source: firstAttrs.source, label: firstAttrs.label } : null;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <nav className="mb-2 flex items-center gap-2 text-sm" aria-label="경로">
        <Link href={assignmentsHref(surveyId)} className="text-blue-600 hover:underline">
          컨택원 관리
        </Link>
        <span className="text-slate-400">›</span>
        <span className="text-slate-600">{assignment.name}</span>
      </nav>
      <h2 className="mb-4 text-xl font-bold text-gray-900">컨택원 수정</h2>
      <AssignmentEditor
        surveyId={surveyId}
        assignment={assignment}
        columnCandidates={columnCandidates}
        resultCodeOptions={resultCodes}
        assignmentOptions={assignmentOptions}
        displayColumn={displayColumn}
      />
    </main>
  );
}
