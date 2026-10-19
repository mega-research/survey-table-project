import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AddAssignmentButton } from '@/features/operations/contacts/assignments/add-assignment-button';
import { AssignmentList } from '@/features/operations/contacts/assignments/assignment-list';
import { isGuestViewer } from '@/lib/auth/guest-viewer';
import { listAssignmentsWithStats } from '@/server/contacts/services/contact-assignments';
import { getOperationsDataScope } from '@/server/data-scope';

export const metadata: Metadata = {
  title: '현황 - 컨택원 관리',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * 컨택원 관리 (시안 B) — 이 세션 파티션(실/테스트)의 컨택원 목록.
 * 내부 실사 운영 도구라 게스트에게는 없다(미들웨어도 경로를 막는다).
 */
export default async function ContactAssignmentsPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  if (await isGuestViewer()) notFound();
  const scope = await getOperationsDataScope(surveyId);
  const data = await listAssignmentsWithStats(surveyId, scope);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">컨택원 관리</h2>
          <p className="text-sm text-slate-500">
            조사 대상을 나눠 맡길 묶음입니다 — 차수·외주팀·사람 누구든 이름만 붙이면 됩니다.
            {scope === 'test' ? ' 지금은 테스트 데이터의 컨택원입니다.' : ''}
          </p>
        </div>
        <AddAssignmentButton surveyId={surveyId} />
      </div>
      <AssignmentList surveyId={surveyId} data={data} />
    </main>
  );
}
