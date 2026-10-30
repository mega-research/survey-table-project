import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ScaleMeanTable } from '@/features/operations/scale-mean/scale-mean-table';
import { isGuestViewer } from '@/lib/auth/guest-viewer';
import { getOperationsDataScope } from '@/server/data-scope';
import { getScaleMeanSummary } from '@/server/operations/services/scale-mean';

export const metadata: Metadata = {
  title: '현황 - 척도 평균',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * 척도 평균 (CONTEXT.md 「척도 평균」) — 「척도 평균에 넣기」를 켠 문항의 완료 응답 평균·응답수.
 * 내부 담당자용이라 게스트는 미들웨어(guestPathRedirect)가 먼저 돌려보내고, 여기서도 막는다.
 * 존재 확인·헤더·탭은 상위 layout 소관이다.
 */
export default async function ScaleMeanPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  if (await isGuestViewer()) notFound();

  const scope = await getOperationsDataScope(surveyId);
  const summary = await getScaleMeanSummary(surveyId, scope);

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-6 py-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-gray-900">척도 평균</h2>
        <p className="text-sm text-gray-500">
          완료 응답 기준 · 「척도 평균에 넣기」를 켠 문항만 나옵니다 · 「평균에서 제외」 보기는 평균과
          응답수에서 빠집니다
        </p>
      </div>
      <ScaleMeanTable surveyId={surveyId} summary={summary} />
    </main>
  );
}
