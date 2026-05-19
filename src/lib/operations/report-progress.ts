/**
 * 진척률 표 pure helper (Report 탭 / slice 4).
 *
 * - toneFromRate: 응답률 임계값 → pill 색상.
 * - sortGroupRows: 정렬 + NULLS LAST.
 * - computeTotals: 푸터 합계 계산.
 *
 * 클로징 정의: W∪A — survey_responses.is_completed=true OR
 * contact_attempts.result_code='1.조사완료'. SQL 집계는 server.ts 의 FILTER 절 참고.
 *
 * Known Limitation: '1.조사완료' hardcoded — slice 6/7 에서
 * ContactResultCode.isClosing 토글 도입 후 동적화.
 */

export const CLOSING_RESULT_CODES = ['1.조사완료'] as const;

export type ProgressTone = 'green' | 'amber' | 'rose' | 'gray';

/** 응답률 → pill 색상. spec §"임계값" 참조. */
export function toneFromRate(completedCount: number, listCount: number): ProgressTone {
  if (listCount === 0) return 'gray';
  const rate = (completedCount / listCount) * 100;
  if (rate === 0) return 'gray';
  if (rate < 25) return 'rose';
  if (rate < 50) return 'amber';
  return 'green';
}

/** 진척률 표 한 행 (그룹 1개) — SQL 결과를 클라이언트 형태로 변환한 것. */
export interface ProgressRow {
  /** 표시 라벨 — group_value=NULL 인 경우 '(미분류)' */
  groupLabel: string;
  /** 원본 group_value (NULL 식별용) */
  groupValueRaw: string | null;
  /** 그룹 내 MIN(resid) — 표 첫 컬럼 '#' 에 표시. */
  firstResid: number | null;
  listCount: number;
  completedCount: number;
  /** key=ProgressColumnDef.key, value=MIN(attrs->>key) 또는 null */
  meta: Record<string, string | null>;
}

export type ProgressSortKey =
  | 'firstResid'
  | 'groupLabel'
  | 'listCount'
  | 'completedCount'
  | 'responseRate'
  | `meta:${string}`;

export type SortDir = 'asc' | 'desc';

/**
 * NULLS LAST 정렬. server SQL 의 ORDER BY 와 일관.
 * 메타 키 'meta:<key>' 는 row.meta[key] 비교.
 */
export function sortGroupRows(
  rows: ProgressRow[],
  sort: ProgressSortKey,
  dir: SortDir,
): ProgressRow[] {
  const cmp = (a: ProgressRow, b: ProgressRow): number => {
    const av = sortValue(a, sort);
    const bv = sortValue(b, sort);
    // NULLS LAST: null/undefined 는 항상 큼 (asc/desc 와 무관)
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      return dir === 'asc' ? av - bv : bv - av;
    }
    const as = String(av);
    const bs = String(bv);
    return dir === 'asc' ? as.localeCompare(bs, 'ko') : bs.localeCompare(as, 'ko');
  };
  return [...rows].sort(cmp);
}

function sortValue(row: ProgressRow, sort: ProgressSortKey): number | string | null {
  if (sort === 'firstResid') return row.firstResid;
  if (sort === 'groupLabel') return row.groupLabel;
  if (sort === 'listCount') return row.listCount;
  if (sort === 'completedCount') return row.completedCount;
  if (sort === 'responseRate') {
    if (row.listCount === 0) return null; // gray 행 → NULLS LAST
    return (row.completedCount / row.listCount) * 100;
  }
  if (sort.startsWith('meta:')) {
    const key = sort.slice(5);
    return row.meta[key] ?? null;
  }
  return null;
}

export interface ProgressTotals {
  groupCount: number;
  listTotal: number;
  completedTotal: number;
}

/** 푸터 합계 — "총 N개 그룹 · 리스트 합계 X / 완료 Y". */
export function computeTotals(rows: ProgressRow[]): ProgressTotals {
  return rows.reduce<ProgressTotals>(
    (acc, r) => ({
      groupCount: acc.groupCount + 1,
      listTotal: acc.listTotal + r.listCount,
      completedTotal: acc.completedTotal + r.completedCount,
    }),
    { groupCount: 0, listTotal: 0, completedTotal: 0 },
  );
}
