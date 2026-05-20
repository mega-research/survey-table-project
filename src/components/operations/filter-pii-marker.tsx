import { FILTER_SOURCE } from '@/lib/operations/filter-shared';

/**
 * pii.* 컬럼 옵션 옆에 표시되는 "(정확 일치)" 마커.
 * Select option / 칩 등 컬럼 라벨 옆에서 공통으로 사용.
 */
export function PiiExactMarker({ source }: { source: string }) {
  if (!source.startsWith(FILTER_SOURCE.PII_PREFIX)) return null;
  return <span className="ml-1 text-xs text-muted-foreground">(정확 일치)</span>;
}
