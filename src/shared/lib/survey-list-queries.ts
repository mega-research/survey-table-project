import { orpc } from './rpc';

/**
 * 설문 목록 조회의 공유 조각 — 키와 조회 옵션.
 *
 * 두 묶음이 같은 목록을 본다 — 설문 목록 화면(survey-builder)과 실사팀 사이드바의 참여 트리
 * (workspace). feature 끼리 직접 import 할 수 없으므로 키와 옵션만 여기에 둔다
 * (survey-group-queries 와 같은 탈출구). 사이드바가 따로 세면 본문 카드 수와 갈린다.
 * mutation 은 survey-builder 에 남는다.
 */
export const surveyKeys = {
  all: ['surveys'] as const,
  lists: () => [...surveyKeys.all, 'list'] as const,
  list: (filters?: string) => [...surveyKeys.lists(), filters] as const,
  details: () => [...surveyKeys.all, 'detail'] as const,
  detail: (id: string) => [...surveyKeys.details(), id] as const,
};

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
