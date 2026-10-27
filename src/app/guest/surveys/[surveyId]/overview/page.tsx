import {
  type ClientOverviewSearchParams,
  ClientOverviewScreen,
} from '@/app/_client-console/overview-screen';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';

interface Props {
  params: Promise<{ surveyId: string }>;
  searchParams: Promise<ClientOverviewSearchParams>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 현황' };

/**
 * 응답 현황 — 게스트 계정 입구. 본문은 클라이언트 링크 입구와 함께 쓴다
 * (`app/_client-console/overview-screen`, ADR-0029). 이 page 가 하는 일은 관문 하나다.
 */
export default async function GuestOverviewPage({ params, searchParams }: Props) {
  const { surveyId } = await params;
  const { tabs } = await assertGuestSurveyPageAccess(surveyId, 'overview');

  return (
    <ClientOverviewScreen
      surveyId={surveyId}
      showQuota={tabs.quota}
      // 게스트 계정에는 상세 통계 칩이 없다 — 칩 이전과 같이 전부 그린다(철거 대상이라 넓히지 않는다).
      showDetail
      searchParams={await searchParams}
    />
  );
}
