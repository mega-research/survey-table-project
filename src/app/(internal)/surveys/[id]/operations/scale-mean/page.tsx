import type { Metadata } from 'next';

import { ScaleMeanPickerDialog } from '@/features/operations/scale-mean/scale-mean-picker-dialog';
import { ScaleMeanTable } from '@/features/operations/scale-mean/scale-mean-table';
import { requireAdminPage } from '@/lib/auth/require-admin-page';
import { getOperationsDataScope } from '@/server/data-scope';
import { getScaleMeanView } from '@/server/operations/services/scale-mean';
import { assertSurveyCapabilityPage } from '@/server/page-survey-access';

export const metadata: Metadata = {
  title: '현황 - 척도 평균',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * 척도 평균 (CONTEXT.md 「척도 평균」) — 「문항 선택」으로 고른 문항의 완료 응답 평균·응답수.
 * 내부 담당자용 집계라 내부 콘솔에만 있다 — 외주·클라이언트 링크 콘솔에는 이 화면이 없다.
 * 관문은 쿼터 화면과 같다: 내부 계정(requireAdminPage) + 설문 단위 operations.view.
 * 존재 확인·헤더·탭은 상위 layout 소관이다.
 */
export default async function ScaleMeanPage({ params }: PageProps) {
  const viewer = await requireAdminPage();
  const { id: surveyId } = await params;
  await assertSurveyCapabilityPage(viewer, surveyId, 'operations.view');

  const scope = await getOperationsDataScope(surveyId);
  const { summary, candidates } = await getScaleMeanView(surveyId, scope);

  // 본문 폭 862 = 시안 표 폭(max 910 − 좌우 여백 24) — 표와 제목 줄을 화면 가운데에 둔다
  return (
    <main className="mx-auto max-w-[910px] space-y-4 px-6 py-6">
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
