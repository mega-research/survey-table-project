import type { FilterClause } from '@/lib/operations/filter-shared';
import type { ResolvedContactFilter } from '@/server/read-models/contact-filter-resolution';

/**
 * 테스트 전용 — 절을 손으로 넣은 조사 대상 필터 해석 결과. 앱 코드는 resolveContactFilter 만
 * 이 타입을 만든다. 해석 자체가 관심사가 아닌 테스트(빈 조건으로 목록 읽기, SQL 결합 검사)용이다.
 */
export function resolvedFilterForTest(clauses: FilterClause[] = []): ResolvedContactFilter<'write'> {
  return {
    clauses,
    builderClauses: clauses,
    headerClauses: [],
    unresolved: [],
  } as unknown as ResolvedContactFilter<'write'>;
}
