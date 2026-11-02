import { Suspense } from 'react';

import { cookies } from 'next/headers';

import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';

import {
  applyTrashAccess,
  parseSurveyListQuery,
} from '@/features/survey-builder/survey-list/survey-list-url';
import { SurveyListView } from '@/features/survey-builder/survey-list/survey-list-view';
import { requireAdminPage } from '@/lib/auth/require-admin-page';
import { logger } from '@/lib/logger';
import { listSurveyPage } from '@/server/survey-builder/services/survey-read';
import { WorkScopeError } from '@/server/work-scope';
import type { AuthUser } from '@/shared/contracts/auth';
import type { SurveyListPageQuery } from '@/shared/contracts/survey-builder-io';
import { WORK_SCOPE_COOKIE } from '@/shared/contracts/workspace';
import { surveyListPageQueryOptions, surveyListScopeParam } from '@/shared/lib/survey-list-queries';

/**
 * 설문 목록 (.pen FLOW 6, 역할 모델 v2 티켓 08).
 *
 * 첫 페이지는 서버가 미리 받아 쿼리 캐시로 넘긴다 — 화면이 뜬 뒤에야 read.listPage 를 부르면 그
 * 왕복(과 그쪽 함수의 콜드 스타트)이 첫 진입에 그대로 얹힌다. 키는 화면과 같은 함수로 만든다 —
 * 범위는 surveyListScopeParam, 조건은 주소를 읽는 parseSurveyListQuery. 이후 범위·조건 전환과
 * 갱신은 클라이언트 뷰가 RPC 로 한다.
 *
 * 범위 해석은 레이아웃 셸과 같은 코어·같은 쿠키를 지나므로 셸의 초기 범위와 키가 맞는다.
 * 미리 받기에 실패해도 페이지는 막지 않는다 — 캐시가 비어 있으면 화면이 종전대로 조회한다.
 *
 * 뷰가 목록 조건(그룹 화면 `?group=` 포함)을 useSearchParams 로 읽으므로 Suspense 경계가
 * 필요하다 — 없으면 프리렌더에서 트리 전체가 CSR 로 밀린다.
 */
export default async function SurveyListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdminPage();
  // 휴지통 적용은 화면과 같은 함수로 — 휴지통은 슈퍼어드민만 연다. 슈퍼어드민이라도 시스템 범위가
  // 아니면 서버가 거부해 미리 받기만 건너뛴다(화면이 휴지통을 끈 조건으로 조회한다).
  const query = applyTrashAccess(
    parseSurveyListQuery(toUrlSearchParams(await searchParams)),
    user.isSuperadmin,
  );
  const queryClient = new QueryClient();
  const initial = await loadInitialSurveyPage(user, query);
  if (initial) {
    queryClient.setQueryData(
      surveyListPageQueryOptions(surveyListScopeParam(initial.scope), query).queryKey,
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

/**
 * 같은 이름이 여러 번 오면 모두 순서대로 담는다 — 화면의 useSearchParams 와 같은 모양이라 `get` 은
 * 첫 값, `getAll` 은 전부(검색 칩 `tag` 가 여러 번 온다)를 읽는다.
 */
function toUrlSearchParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, one);
    }
  }
  return params;
}

async function loadInitialSurveyPage(user: AuthUser, query: SurveyListPageQuery) {
  const requestedScope = (await cookies()).get(WORK_SCOPE_COOKIE)?.value ?? null;
  try {
    try {
      return await listSurveyPage(user, { ...query, scope: requestedScope });
    } catch (error) {
      // 쿠키는 편의값이다 — 무효 범위(강등된 슈퍼어드민의 'system' 잔존 등)는 셸처럼 기본 범위로 접는다.
      if (!(error instanceof WorkScopeError)) throw error;
      return await listSurveyPage(user, { ...query, scope: null });
    }
  } catch (error) {
    logger.warn(
      { err: error, userId: user.id },
      '[survey-list] 첫 목록 미리 받기 실패 — 화면이 조회한다',
    );
    return null;
  }
}
