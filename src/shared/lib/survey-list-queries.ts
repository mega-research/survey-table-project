import { SYSTEM_SCOPE, type WorkScope } from '@/shared/contracts/workspace';

import { orpc } from './rpc';

/**
 * 설문 목록 조회의 공유 조각 — 키와 조회 옵션.
 *
 * 두 묶음이 같은 범위의 설문을 본다 — 설문 목록 화면(survey-builder)과 실사팀 사이드바의 참여
 * 트리(workspace). feature 끼리 직접 import 할 수 없으므로 키와 옵션만 여기에 둔다
 * (survey-group-queries 와 같은 탈출구). 사이드바는 응답 수 없는 요약 조회(listSummaries)를 쓰고,
 * 서버가 목록과 같은 범위 조건을 써서 본문 카드 수와 갈리지 않는다. mutation 은 survey-builder 에 남는다.
 */
export const surveyKeys = {
  all: ['surveys'] as const,
  lists: () => [...surveyKeys.all, 'list'] as const,
  list: (filters?: string) => [...surveyKeys.lists(), filters] as const,
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
 * 설문 목록 조회 — 작업 범위로 좁힌 결과 + 고를 수 있는 범위 (티켓 07).
 *
 * scope 는 화면이 고른 값일 뿐이라 서버가 멤버십으로 다시 판정한다. 응답의 scope 가
 * 요청과 다를 수 있으므로(해산된 팀 등) 화면은 응답 쪽을 정답으로 삼아야 한다.
 */
export function surveyListQueryOptions(scope?: string | null, deleted = false) {
  return {
    // 휴지통은 조회 조건이 다르므로 키가 갈려야 한다 — 같은 키를 쓰면 모드를 오갈 때마다
    // 서로의 캐시를 덮어써 목록이 한 번씩 반대편 내용으로 번쩍인다(티켓 17).
    // 일반 목록의 키는 종전 그대로 둔다(범위 미지정이면 undefined) — 접미사를 늘 붙이면
    // 기존 캐시가 통째로 갈려 아무 이득 없이 첫 진입이 한 번 더 왕복한다.
    queryKey: deleted
      ? surveyKeys.list(`${scope ?? ''}|deleted`)
      : surveyKeys.list(scope ?? undefined),
    queryFn: () => orpc.surveyBuilder.read.list.call({ scope: scope ?? null, deleted }),
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
