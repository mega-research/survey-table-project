import {
  type ClientOverviewSearchParams,
  ClientOverviewScreen,
} from '@/app/_client-console/overview-screen';
import { assertClientLinkPageAccess } from '@/server/page-client-link-access';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<ClientOverviewSearchParams>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 현황' };

/**
 * 응답 현황 — 클라이언트 링크 입구. 본문은 게스트 계정 입구와 함께 쓴다
 * (`app/_client-console/overview-screen`, ADR-0029). 이 page 가 하는 일은 관문 하나다.
 */
export default async function ClientLinkOverviewPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { surveyId, tabs } = await assertClientLinkPageAccess(token, 'overview');

  return (
    <ClientOverviewScreen
      surveyId={surveyId}
      // 쿼터 칸은 쿼터 탭이 열렸을 때만 — 탭을 닫았는데 현황 화면에서 같은 숫자가 보이면 안 된다.
      showQuota={tabs.quota}
      searchParams={await searchParams}
    />
  );
}
