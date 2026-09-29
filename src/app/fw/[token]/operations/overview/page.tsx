import type { Metadata } from 'next';

import { getOperationsDataScope } from '@/server/data-scope';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';

import {
  OperationsOverviewScreen,
  type OperationsOverviewSearchParams,
} from '@/app/_operations/overview-screen';

export const metadata: Metadata = {
  title: '응답 현황',
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<OperationsOverviewSearchParams>;
}

/**
 * 외주가 보는 응답 현황 — `/admin` 과 **같은 위젯·같은 숫자**다 (ADR-0026, 티켓 07, 스토리 34).
 *
 * 축약본을 따로 만들지 않는 것이 요점이다. 연구원과 외주가 다른 숫자를 보면 진척 보고가
 * 어느 쪽이 맞는지 알 수 없어진다. 빠지는 것은 **내보내기 모달 하나**이고 그것도 화면이
 * 아니라 판정(`export.download` 미보유)이 정한다.
 */
export default async function FieldworkLinkOverviewPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { actor, surveyId, capabilities } = await assertFieldworkLinkPageAccess(
    token,
    'operations.view',
  );
  const scope = await getOperationsDataScope(surveyId, actor);

  return (
    <OperationsOverviewScreen
      surveyId={surveyId}
      capabilities={capabilities}
      scope={scope}
      searchParams={await searchParams}
    />
  );
}
