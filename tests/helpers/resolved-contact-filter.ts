import type { FilterClause } from '@/lib/operations/filter-shared';
import { FIELDWORK_SHARE_ALL, type FieldworkShare } from '@/server/fieldwork-share-scope';
import type { ResolvedContactFilter } from '@/server/read-models/contact-filter-resolution';

/**
 * 테스트 전용 — 절을 손으로 넣은 조사 대상 필터 해석 결과. 앱 코드는 resolveContactFilter 만
 * 이 타입을 만든다. 해석 자체가 관심사가 아닌 테스트(빈 조건으로 목록 읽기, SQL 결합 검사)용이다.
 * 담당 범위(강제 절)는 넘기지 않으면 설문 전체다.
 */
export function resolvedFilterForTest(
  clauses: FilterClause[] = [],
  share: FieldworkShare = FIELDWORK_SHARE_ALL,
): ResolvedContactFilter<'write'> {
  return {
    clauses,
    builderClauses: clauses,
    headerClauses: [],
    unresolved: [],
    share,
  } as unknown as ResolvedContactFilter<'write'>;
}
