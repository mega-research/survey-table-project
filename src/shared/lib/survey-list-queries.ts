import type { SurveyListPageQuery } from '@/shared/contracts/survey-builder-io';
import { SYSTEM_SCOPE, type WorkScope } from '@/shared/contracts/workspace';

import { orpc } from './rpc';

/**
 * 설문 목록 조회의 공유 조각 — 키와 조회 옵션.
 *
 * 두 묶음이 같은 범위의 설문을 본다 — 설문 목록 화면(survey-builder, 페이지 조회 listPage)과
 * 실사팀 사이드바의 참여 트리(workspace, 요약 조회 listSummaries). feature 끼리 직접 import 할 수
 * 없으므로 키와 옵션만 여기에 둔다(survey-group-queries 와 같은 탈출구). 서버가 두 조회에 같은 범위
 * 조건을 써서 사이드바 숫자와 본문 카드 수가 갈리지 않는다. mutation 은 survey-builder 에 남는다.
 */
export const surveyKeys = {
  all: ['surveys'] as const,
  lists: () => [...surveyKeys.all, 'list'] as const,
  /**
   * 목록 페이지 전부 — 별·태그 같은 카드 단위 낙관적 갱신이 `setQueriesData` 로 훑을 접두.
   * `lists()` 로 훑으면 모양이 다른 요약 캐시(배열)까지 잡히니 이 키로 좁힐 것.
   */
  pages: () => [...surveyKeys.lists(), 'page'] as const,
  /**
   * 목록 한 페이지 — 범위 + 조건 전체가 키다(조건이 곧 조회). `lists()` 아래라 설문 생성·이동·
   * 삭제·공유 설정이 접는 무효화를 그대로 받는다.
   */
  page: (scope: string | null, query: SurveyListPageQuery) =>
    [...surveyKeys.pages(), scope, query] as const,
  /**
   * 사이드바 요약 — 일부러 `lists()` 아래에 둔다. 설문 생성·이동·삭제·공유 설정이 접는
   * `surveyKeys.lists()` 무효화가 그대로 요약까지 닿아, mutation 마다 줄을 더하지 않아도 된다.
   */
  summaries: (scope: string | null) => [...surveyKeys.lists(), 'summaries', scope] as const,
  details: () => [...surveyKeys.all, 'detail'] as const,
  detail: (id: string) => [...surveyKeys.details(), id] as const,
};

/**
 * 해석된 작업 범위 → 목록 조회가 지목하는 범위 값(곧 쿼리 키).
 *
 * 화면(작업 범위 컨텍스트)과 서버 페이지(미리 채우는 목록)가 같은 키를 써야 미리 받은 목록이
 * 쓰인다 — 각자 접으면 키가 갈려 첫 진입이 한 번 더 왕복한다. 범위가 없거나(팀 미배치)
 * 셸 밖이면 지목하지 않는다 — 서버가 쿠키·멤버십으로 해석한다.
 */
export function surveyListScopeParam(scope: WorkScope | null): string | null {
  if (scope?.kind === 'system') return SYSTEM_SCOPE;
  if (scope?.kind === 'team') return scope.teamId;
  return null;
}

/**
 * 설문 목록 한 페이지 — 서버가 거르고 정렬하고 나눈 결과 + 고를 수 있는 범위(티켓 03).
 *
 * scope 는 화면이 고른 값일 뿐이라 서버가 멤버십으로 다시 판정한다. 응답의 scope 가 요청과 다를
 * 수 있으므로(해산된 팀 등) 화면은 응답 쪽을 정답으로 삼아야 한다. 휴지통은 조건의 `deleted` 라
 * 키가 저절로 갈린다.
 */
export function surveyListPageQueryOptions(scope: string | null, query: SurveyListPageQuery) {
  return {
    queryKey: surveyKeys.page(scope, query),
    queryFn: () => orpc.surveyBuilder.read.listPage.call({ ...query, scope }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  };
}

/**
 * 사이드바 요약 조회 — 작업 범위의 설문 id·팀·그룹·제목만, 응답 수 없음(설문 즐겨찾기·태그 티켓 02).
 *
 * 목록이 페이지 단위로 바뀌어도 사이드바 참여 트리는 범위 전체를 센다. 범위 해석은 목록과 같이
 * 서버가 다시 한다.
 */
export function surveySummaryListQueryOptions(scope: string | null) {
  return {
    queryKey: surveyKeys.summaries(scope),
    queryFn: () => orpc.surveyBuilder.read.listSummaries.call({ scope }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  };
}
