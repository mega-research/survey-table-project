import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AssignmentEditor } from '@/features/operations/contacts/assignments/assignment-editor';
import { assignmentsHref } from '@/features/operations/contacts/assignments/assignment-hrefs';
import { isGuestViewer } from '@/lib/auth/guest-viewer';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import {
  getAssignmentForEdit,
  listAssignmentOptions,
} from '@/server/contacts/services/contact-assignments';
import { getOperationsDataScope } from '@/server/data-scope';
import {
  buildColumnCandidates,
  getContactColumnScheme,
  getContactResultCodes,
} from '@/server/read-models/contacts';

export const metadata: Metadata = {
  title: '현황 - 컨택원 수정',
};

interface PageProps {
  params: Promise<{ id: string; assignmentId: string }>;
}

/**
 * 컨택원 수정 (시안 C) — 이름과 배정할 대상 조건을 정하고 교체 적용한다.
 * 다시 열면 마지막으로 적용한 조건이 채워진다. 게스트에게는 없다.
 */
export default async function ContactAssignmentEditPage({ params }: PageProps) {
  const { id: surveyId, assignmentId } = await params;
  if (await isGuestViewer()) notFound();
  const scope = await getOperationsDataScope(surveyId);

  const [assignment, scheme, resultCodes, assignmentOptions] = await Promise.all([
    getAssignmentForEdit(surveyId, scope, assignmentId),
    getContactColumnScheme(surveyId, scope),
    getContactResultCodes(surveyId),
    listAssignmentOptions(surveyId, scope),
  ]);
  if (!assignment) notFound();

  // 「전체」 부분검색은 배정 조건으로 쓰지 않는다 — 어느 열에서 걸렸는지 설명할 수 없다.
  const columnCandidates = buildColumnCandidates(scheme, { includeContactOwner: true }).filter(
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
