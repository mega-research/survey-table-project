import type { Metadata } from 'next';

import { getOperationsDataScope } from '@/server/data-scope';
import { assertSurveyConsolePageAccess } from '@/server/page-survey-access';
import { loadSurveyCapabilities } from '@/server/survey-access';

import {
  OperationsOverviewScreen,
  type OperationsOverviewSearchParams,
} from '@/app/_operations/overview-screen';

/**
 * 플랜 §9 정책 — 30초 자동 폴링 의도.
 *
 * 본 라우트는 `searchParams` 를 사용하므로 Next.js 16 의 동적 렌더 규칙상
 * 매 요청 RSC 가 재평가된다 → `revalidate` 는 동적 라우트에서는 사실상 무력화되며
 * ISR 캐시가 활성화된 환경에서만 의미를 갖는다.
 *
 * 사용자 체감 갱신은 (a) 페이지 진입/네비게이션 (b) `<RefreshButton />` 의
 * `router.refresh()` 두 경로로 보장된다. 향후 정적/캐시 환경에서 의미를 살리기
 * 위해 의도값은 보존한다.
 */
export const revalidate = 30;

export const metadata: Metadata = {
  title: '현황 - 응답 진행 현황',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<OperationsOverviewSearchParams>;
}

/**
 * 응답 현황 — 화면 정의는 `OperationsOverviewScreen` 이 갖고 여기는 관문·주체 해석만 한다.
 *
 * 외주 실사 링크 트리(`/fw/[token]/operations/overview`)가 **같은 본문**을 다른 capability·
 * 다른 파티션으로 렌더한다(ADR-0026). 여기에 화면을 되돌려 쓰지 말 것.
 */
export default async function OperationsOverviewPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  // 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 세션이 폐기된 뒤에도
  // 이 페이지가 서비스를 직접 불러 데이터를 렌더할 수 있어 여기서 다시 묻는다(티켓 10).
  const viewer = await assertSurveyConsolePageAccess(surveyId, 'operations.view');
  const [scope, capabilities] = await Promise.all([
    getOperationsDataScope(surveyId),
    loadSurveyCapabilities(viewer, surveyId),
  ]);

  return (
    <OperationsOverviewScreen
      surveyId={surveyId}
      capabilities={capabilities}
      scope={scope}
      searchParams={await searchParams}
    />
  );
}
