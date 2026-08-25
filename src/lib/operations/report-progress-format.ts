/**
 * 진척률 표 pure helper (Report 탭 / slice 4).
 *
 * - toneFromRate: 응답률 임계값 → pill 색상.
 * - sortGroupRows: 정렬 + NULLS LAST.
 * - computeTotals: 푸터 합계 계산.
 *
 * 클로징 정의: W∪A — survey_responses.is_completed=true OR
 * contact_attempts.result_code = ANY(positive codes). positive codes 는
 * `getResultCodeStatuses(surveyId).positive` 로 동적 추출. SQL 집계는
 * server.ts 의 FILTER 절 참고.
 */

export type ProgressTone = 'green' | 'amber' | 'rose' | 'gray';

/**
 * 응답률(%) 단일 산식. pill 라벨(formatRate)·색상(toneFromRate)·정렬(responseRate)이
 * 동일한 계산을 공유하도록 여기서만 정의한다. listCount=0 처리는 호출부 책임.
 */
export function computeRate(completedCount: number, listCount: number): number {
  return (completedCount / listCount) * 100;
}

/** 응답률 → pill 색상. spec §"임계값" 참조. */
export function toneFromRate(completedCount: number, listCount: number): ProgressTone {
  if (listCount === 0) return 'gray';
  const rate = computeRate(completedCount, listCount);
  if (rate === 0) return 'gray';
  if (rate < 25) return 'rose';
  if (rate < 50) return 'amber';
  return 'green';
}

/** 진척률 표 한 행 (그룹 1개) — SQL 결과를 클라이언트 형태로 변환한 것. */
export interface ProgressRow {
  /** 표시 라벨 — group_value=NULL 인 경우 '(미분류)'. 다중 기준이면 ' / ' 조인. */
  groupLabel: string;
  /** 원본 group_value (NULL 식별용). 다중 기준이면 조합 키(progressCellKey). */
  groupValueRaw: string | null;
  /**
   * 활성 분류 기준 키 순서대로의 그룹 값. 기본(group_value) 모드면 길이 1.
   * null = 해당 기준 값 미분류.
   */
  groupValues: (string | null)[];
  /** 그룹 내 MIN(resid) — 표 첫 컬럼 '#' 에 표시. */
  firstResid: number | null;
  /** 분모 — excludeFilter 적용 후. 응답률 계산에 사용. */
  listCount: number;
  /** 분자 — closingFilter AND NOT excludeFilter. */
  completedCount: number;
  /** 부정 결과코드 OR unsubscribed_at 으로 모집단에서 제외된 ct 수. */
  excludedCount: number;
  /** key=ProgressColumnDef.key, value=MIN(attrs->>key) 또는 null */
  meta: Record<string, string | null>;
}

export type ProgressSortKey =
  | 'firstResid'
  | 'groupLabel'
  | 'listCount'
  | 'completedCount'
  | 'responseRate'
  | `meta:${string}`
  // group:<attrs키> — 배열 인덱스가 아닌 안정 식별자 (칩 on/off 재인덱싱에 불변)
  | `group:${string}`;

export type SortDir = 'asc' | 'desc';

/**
 * NULLS LAST 정렬. server SQL 의 ORDER BY 와 일관.
 * 메타 키 'meta:<key>' 는 row.meta[key] 비교.
 * 'group:<attrs키>' 는 groupKeys(활성 기준 키 순서)로 인덱스를 해석 — 미전달 시 null 취급.
 */
export function sortGroupRows(
  rows: ProgressRow[],
  sort: ProgressSortKey,
  dir: SortDir,
  groupKeys: string[] = [],
): ProgressRow[] {
  const cmp = (a: ProgressRow, b: ProgressRow): number => {
    const av = sortValue(a, sort, groupKeys);
    const bv = sortValue(b, sort, groupKeys);
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

function sortValue(
  row: ProgressRow,
  sort: ProgressSortKey,
  groupKeys: string[],
): number | string | null {
  if (sort === 'firstResid') return row.firstResid;
  if (sort === 'groupLabel') return row.groupLabel;
  if (sort === 'listCount') return row.listCount;
  if (sort === 'completedCount') return row.completedCount;
  if (sort === 'responseRate') {
    if (row.listCount === 0) return null; // gray 행 → NULLS LAST
    return computeRate(row.completedCount, row.listCount);
  }
  if (sort.startsWith('meta:')) {
    const key = sort.slice(5);
    return row.meta[key] ?? null;
  }
  if (sort.startsWith('group:')) {
    const idx = groupKeys.indexOf(sort.slice(6));
    if (idx < 0) return null;
    return row.groupValues[idx] ?? null;
  }
  return null;
}

export interface ProgressTotals {
  groupCount: number;
  listTotal: number;
  completedTotal: number;
  /** 푸터 합계 — 모집단 제외 ct 누적. */
  excludedTotal: number;
  /**
   * 제외 사유별 내역 — 서로 겹치지 않는 버킷이라 셋의 합이 `excludedTotal` 과 같다.
   * 행 단위 합산(computeTotals)에는 사유 정보가 없어 0 으로 남는다.
   */
  excludedScreenedOut: number;
  excludedNegativeCode: number;
  excludedUnsubscribed: number;
}

/** 조사 대상 0건 등 집계를 돌릴 필요가 없을 때 쓰는 빈 합계. */
export const EMPTY_PROGRESS_TOTALS: ProgressTotals = {
  groupCount: 0,
  listTotal: 0,
  completedTotal: 0,
  excludedTotal: 0,
  excludedScreenedOut: 0,
  excludedNegativeCode: 0,
  excludedUnsubscribed: 0,
};

/** 푸터 합계 — "총 N개 그룹 · 리스트 합계 X / 완료 Y · 제외 Z". */
export function computeTotals(rows: ProgressRow[]): ProgressTotals {
  return rows.reduce<ProgressTotals>(
    (acc, r) => ({
      ...acc,
      groupCount: acc.groupCount + 1,
      listTotal: acc.listTotal + r.listCount,
      completedTotal: acc.completedTotal + r.completedCount,
      excludedTotal: acc.excludedTotal + r.excludedCount,
    }),
    {
      groupCount: 0,
      listTotal: 0,
      completedTotal: 0,
      excludedTotal: 0,
      excludedScreenedOut: 0,
      excludedNegativeCode: 0,
      excludedUnsubscribed: 0,
    },
  );
}
