import type { Metadata } from 'next';

import { getOperationsDataScope } from '@/server/data-scope';
import { resolveFieldworkShare } from '@/server/fieldwork-share';
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
 * 외주가 보는 응답 현황 — 내부 콘솔과 **같은 위젯**이다 (ADR-0026, 티켓 07, 스토리 34).
 *
 * 축약본을 따로 만들지 않는 것이 요점이다. 빠지는 것은 **내보내기 모달 하나**이고 그것도 화면이
 * 아니라 판정(`export.download` 미보유)이 정한다.
 *
 * 숫자는 담당 범위를 따른다(ADR-0035) — 한 번도 나누지 않은 링크는 내부 콘솔과 같은 설문 전체를,
 * 나눈 링크는 자기 범위 대상의 응답만 본다. 범위는 매 요청 링크 행에서 읽으므로 연구원이 범위를
 * 바꾸면 다음 화면부터 반영된다.
 *
 * 쿼터 조각도 같은 담당 범위로 갈린다 — 나눈 링크는 셀마다 내 달성 수·마감 여부만 받고(전체 목표·전체 달성
 * 수는 이 화면의 payload 에 없다), 나누지 않은 링크는 연구원과 같은 전체 현황이다.
 */
export default async function FieldworkLinkOverviewPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { actor, surveyId, capabilities } = await assertFieldworkLinkPageAccess(
    token,
    'operations.view',
  );
  const scope = await getOperationsDataScope(surveyId, actor);
  const share = resolveFieldworkShare(actor, surveyId);

  return (
    <OperationsOverviewScreen
      surveyId={surveyId}
      capabilities={capabilities}
      scope={scope}
      share={share}
      searchParams={await searchParams}
    />
  );
}
