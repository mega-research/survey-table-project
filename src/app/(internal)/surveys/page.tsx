import { Suspense } from 'react';

import { cookies } from 'next/headers';

import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';

import { SurveyListView } from '@/features/survey-builder/survey-list/survey-list-view';
import { requireAdminPage } from '@/lib/auth/require-admin-page';
import { logger } from '@/lib/logger';
import { getSurveyListWithCounts } from '@/server/survey-builder/services/survey-read';
import { WorkScopeError } from '@/server/work-scope';
import type { AuthUser } from '@/shared/contracts/auth';
import { WORK_SCOPE_COOKIE } from '@/shared/contracts/workspace';
import { surveyListQueryOptions, surveyListScopeParam } from '@/shared/lib/survey-list-queries';

/**
 * 설문 목록 (.pen FLOW 6, 역할 모델 v2 티켓 08).
 *
 * 첫 목록은 서버가 미리 받아 쿼리 캐시로 넘긴다 — 화면이 뜬 뒤에야 read.list 를 부르면 그 왕복
 * (과 그쪽 함수의 콜드 스타트)이 첫 진입에 그대로 얹힌다. 키는 화면과 같은 surveyListScopeParam
 * 으로 만든다. 이후 범위 전환·갱신은 종전대로 클라이언트 뷰가 RPC 로 한다.
 *
 * 범위 해석은 레이아웃 셸과 같은 코어·같은 쿠키를 지나므로 셸의 초기 범위와 키가 맞는다.
 * 미리 받기에 실패해도 페이지는 막지 않는다 — 캐시가 비어 있으면 화면이 종전대로 조회한다.
 *
 * 뷰가 `?group=<id>`(그룹 화면, 티켓 12)를 useSearchParams 로 읽으므로 Suspense 경계가
 * 필요하다 — 없으면 프리렌더에서 트리 전체가 CSR 로 밀린다.
 */
export default async function SurveyListPage() {
  const user = await requireAdminPage();
  const queryClient = new QueryClient();
  const initial = await loadInitialSurveyList(user);
  if (initial) {
    queryClient.setQueryData(
      surveyListQueryOptions(surveyListScopeParam(initial.scope)).queryKey,
      initial,
    );
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={null}>
        <SurveyListView />
      </Suspense>
    </HydrationBoundary>
  );
}

async function loadInitialSurveyList(user: AuthUser) {
  const requestedScope = (await cookies()).get(WORK_SCOPE_COOKIE)?.value ?? null;
  try {
    try {
      return await getSurveyListWithCounts(user, requestedScope);
    } catch (error) {
      // 쿠키는 편의값이다 — 무효 범위(강등된 슈퍼어드민의 'system' 잔존 등)는 셸처럼 기본 범위로 접는다.
      if (!(error instanceof WorkScopeError)) throw error;
      return await getSurveyListWithCounts(user, null);
    }
  } catch (error) {
    logger.warn(
      { err: error, userId: user.id },
      '[survey-list] 첫 목록 미리 받기 실패 — 화면이 조회한다',
    );
    return null;
  }
}
