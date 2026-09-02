import type { Metadata } from 'next';

import { DemandSummaryTable } from '@/components/operations/demand/demand-summary-table';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';
import { getDemandSummary } from '@/lib/operations/demand-summary.server';

export const metadata: Metadata = {
  title: '현황 - 문항 수요',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * 문항 수요조사 집계 — 운영 콘솔 전용 탭 하나.
 *
 * 분석 대시보드도 엑셀 전용도 아니다. 기존 분석은 질문 하나당 카드 하나를 세로로
 * 쌓는데 조사표 83문항이면 카드가 83개 쌓이고 정작 "무엇을 뺄까"를 못 고른다.
 *
 * 존재 확인·헤더·탭은 상위 layout 소관이다.
 */
export default async function DemandSummaryPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  const scope = await getOperationsDataScope(surveyId);
  const rows = await getDemandSummary(surveyId, scope);

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <DemandSummaryTable surveyId={surveyId} rows={rows} />
    </main>
  );
}
