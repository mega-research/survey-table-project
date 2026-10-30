import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ScaleMeanPickerDialog } from '@/features/operations/scale-mean/scale-mean-picker-dialog';
import { ScaleMeanTable } from '@/features/operations/scale-mean/scale-mean-table';
import { isGuestViewer } from '@/lib/auth/guest-viewer';
import { getOperationsDataScope } from '@/server/data-scope';
import { getScaleMeanView } from '@/server/operations/services/scale-mean';

export const metadata: Metadata = {
  title: '현황 - 척도 평균',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * 척도 평균 (CONTEXT.md 「척도 평균」) — 「문항 선택」으로 고른 문항의 완료 응답 평균·응답수.
 * 내부 담당자용이라 게스트는 미들웨어(guestPathRedirect)가 먼저 돌려보내고, 여기서도 막는다.
 * 존재 확인·헤더·탭은 상위 layout 소관이다.
 */
export default async function ScaleMeanPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  if (await isGuestViewer()) notFound();

  const scope = await getOperationsDataScope(surveyId);
  const { summary, candidates } = await getScaleMeanView(surveyId, scope);

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-6 py-6">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-gray-900">척도 평균</h2>
        {summary.overall.kind !== 'empty' && (
          <ScaleMeanPickerDialog surveyId={surveyId} candidates={candidates} />
        )}
      </div>
      <ScaleMeanTable surveyId={surveyId} summary={summary} candidates={candidates} />
    </main>
  );
}
