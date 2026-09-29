import type { Metadata } from 'next';

import { adminOperationsBase } from '@/features/operations/operations-paths';
import { getOperationsDataScope } from '@/server/data-scope';
import { assertSurveyConsolePageAccess } from '@/server/page-survey-access';

import { ReportProgressScreen, type ReportProgressSearchParams } from '@/app/_operations/report-screen';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '현황 - 그룹별 진척률',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<ReportProgressSearchParams>;
}

/**
 * 그룹별 진척률 — 화면 정의는 `ReportProgressScreen` 이 갖고 여기는 관문·주체 해석만 한다.
 *
 * 외주 실사 링크 트리(`/fw/[token]/operations/report`)가 **같은 본문**을 자기 base 로
 * 렌더한다(ADR-0026).
 */
export default async function ReportProgressPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  // 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 세션이 폐기된 뒤에도
  // 이 페이지가 서비스를 직접 불러 데이터를 렌더할 수 있어 여기서 다시 묻는다 (티켓 10).
  // 진척률 리포트는 컨택 attrs 를 행 단위로 그리므로 contacts.view 를 요구한다.
  const { capabilities } = await assertSurveyConsolePageAccess(surveyId, 'contacts.view');
  const scope = await getOperationsDataScope(surveyId);

  return (
    <ReportProgressScreen
      surveyId={surveyId}
      basePath={adminOperationsBase(surveyId)}
      capabilities={capabilities}
      scope={scope}
      searchParams={await searchParams}
    />
  );
}
