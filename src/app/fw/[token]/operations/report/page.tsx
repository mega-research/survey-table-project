import type { Metadata } from 'next';

import { fieldworkLinkOperationsBase } from '@/features/operations/operations-paths';
import { getOperationsDataScope } from '@/server/data-scope';
import { resolveFieldworkShare } from '@/server/fieldwork-share-scope';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';

import { ReportProgressScreen, type ReportProgressSearchParams } from '@/app/_operations/report-screen';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '진척 보고',
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<ReportProgressSearchParams>;
}

/**
 * 외주가 보는 그룹별 진척률 — 내부 콘솔과 **같은 본문**이다 (ADR-0026, 티켓 07).
 * 숫자는 담당 범위 대상만으로 센다(ADR-0035 — 나누지 않은 링크는 설문 전체).
 *
 * 관문이 `contacts.view` 인 것은 이 표가 컨택 attrs 를 행 단위로 그리기 때문이고, admin
 * 짝과 같은 요구다. 화면이 만드는 주소는 전부 링크 트리 안에 머문다(`basePath`).
 */
export default async function FieldworkLinkReportPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { actor, surveyId, capabilities } = await assertFieldworkLinkPageAccess(
    token,
    'contacts.view',
  );
  const scope = await getOperationsDataScope(surveyId, actor);

  return (
    <ReportProgressScreen
      surveyId={surveyId}
      basePath={fieldworkLinkOperationsBase(token)}
      capabilities={capabilities}
      scope={scope}
      share={resolveFieldworkShare(actor, surveyId)}
      includeContactOwner={false}
      searchParams={await searchParams}
    />
  );
}
