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
   * 활성 분류 기준 키 순서대로의 그룹 표시 값. 기본(group_value) 모드면 길이 1.
   * attrs 기준은 값 그대로, 시스템 기준은 표시 이름. null = 해당 기준 값 미분류.
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

/**
 * 진척 보고 분류 기준 중 명단 attrs 가 아닌 것 — 시스템이 아는 축.
 * 주소(`groupBy=`)·정렬(`group:<키>`)에는 `system:<이름>` 으로 실린다.
 */
export const PROGRESS_SYSTEM_GROUP_KEYS = [
  // 지금 맡은 컨택원 — 완료도 지금 맡은 컨택원 기준으로 센다 (CONTEXT.md 「배정」).
  'contact_owner',
] as const;
export type ProgressSystemGroupKey = (typeof PROGRESS_SYSTEM_GROUP_KEYS)[number];

/**
 * 분류 기준 태그 키 — attrs 키와 시스템 기준을 구분한다.
 * attrs 키는 접두 없이 그대로 직렬화해 기존 `groupBy=키1,키2` 주소가 그대로 열린다.
 */
export type ProgressGroupKey =
  | { kind: 'attrs'; key: string }
  | { kind: 'system'; key: ProgressSystemGroupKey };

const SYSTEM_GROUP_KEY_PREFIX = 'system:';

/**
 * 직렬화된 분류 키 → 태그 키. `system:` 접두는 항상 시스템 기준으로 읽고(attrs 키가
 * 우연히 같은 접두를 가져도 이긴다), 모르는 시스템 이름은 null — 호출부가 버린다.
 */
export function parseProgressGroupKey(raw: string): ProgressGroupKey | null {
  if (raw.length === 0) return null;
  if (raw.startsWith(SYSTEM_GROUP_KEY_PREFIX)) {
    const name = raw.slice(SYSTEM_GROUP_KEY_PREFIX.length);
    const known = (PROGRESS_SYSTEM_GROUP_KEYS as readonly string[]).includes(name);
    return known ? { kind: 'system', key: name as ProgressSystemGroupKey } : null;
  }
  return { kind: 'attrs', key: raw };
}

export function formatProgressGroupKey(key: ProgressGroupKey): string {
  return key.kind === 'attrs' ? key.key : `${SYSTEM_GROUP_KEY_PREFIX}${key.key}`;
}

/**
 * 표시 열 중 지금 켜진 분류 기준과 겹치지 않는 것만 남긴다.
 *
 * 분류 기준으로 묶은 열은 그 값이 이미 기준 칸에 나온다 — 「표시」까지 켜 둔 열을 그대로 그리면
 * 같은 값이 두 번 보인다. 칩으로 꺼 둔 기준은 묶는 축이 아니므로 표시 열(대표값)로 남는다.
 * 시스템 기준은 명단 attrs 가 아니라 이름이 같아도 다른 열이다.
 */
export function metaColumnsOutsideGroupKeys<T extends { key: string }>(
  columns: readonly T[],
  activeGroupKeys: readonly ProgressGroupKey[],
): T[] {
  const grouped = new Set(activeGroupKeys.filter((k) => k.kind === 'attrs').map((k) => k.key));
  return columns.filter((c) => !grouped.has(c.key));
}

/**
 * 분류 기준의 이름 — 진척률 컬럼 설정에서 고친 라벨이 먼저다.
 *
 * 그 화면은 열마다 라벨과 분류 기준을 한 줄에서 함께 고치므로, 거기서 고친 라벨이 칩·표 머리·
 * 제목에 그대로 나와야 한다. 비웠거나 저장한 적 없는 열은 조사 대상 목록의 라벨로 돌아간다.
 */
export function progressCriterionLabel(
  columns: ReadonlyArray<{ key: string; label: string }>,
  key: string,
  contactLabel: string,
): string {
  return columns.find((c) => c.key === key)?.label.trim() || contactLabel;
}

/**
 * 표시 열 정렬 주소(`meta:<키>`)가 지금 켜진 분류 기준을 가리키면 그 기준의 정렬(`group:<키>`)로 읽는다.
 *
 * 분류 기준과 겹치는 표시 열은 그리지 않으므로(`metaColumnsOutsideGroupKeys`) 그 열의 정렬 주소는
 * 갈 곳이 없어 기본 정렬로 떨어진다 — 같은 값이 기준 칸에 그대로 있으니 그쪽 정렬로 잇는다.
 * 저장해 둔 주소와, 표시 열로 정렬한 채 그 칩을 켜는 경우 둘 다다.
 */
export function remapGroupedMetaSort(
  sort: string | undefined,
  activeGroupKeys: readonly ProgressGroupKey[],
): string | undefined {
  if (!sort?.startsWith('meta:')) return sort;
  const key = sort.slice(5);
  const grouped = activeGroupKeys.some((k) => k.kind === 'attrs' && k.key === key);
  return grouped ? `group:${formatProgressGroupKey({ kind: 'attrs', key })}` : sort;
}

/**
 * 주소에 정렬이 없을 때 이 표가 따를 정렬 — 조사 대상 목록의 기본 정렬 열(컬럼 설정의 「기본 정렬」)이
 * 이 표에 나와 있으면 그 열 오름차순이다. 담당자가 「이 ID 순서가 우리 명단의 순서」라고 정해 둔 열이므로
 * 그룹(전시회 등)을 늘어놓는 표도 같은 순서로 연다.
 *
 * 그 열이 켜진 분류 기준이면 기준 칸의 정렬(`group:<키>`), 표시 열이면 그 열의 정렬(`meta:<키>`)이다.
 * 기본 정렬 열을 정하지 않았거나 그 열이 이 표에 없으면 null — 호출부가 종전 기본(응답률 내림차순)을 쓴다.
 * 머리글을 눌러 바꾼 정렬(주소의 `sort`)이 있으면 이 함수를 부르지 않는다.
 */
export function progressDefaultSort(
  defaultSortAttrsKey: string | null,
  activeGroupKeys: readonly ProgressGroupKey[],
  metaKeys: readonly string[],
): ProgressSortKey | null {
  if (defaultSortAttrsKey === null) return null;
  const grouped = activeGroupKeys.find(
    (k) => k.kind === 'attrs' && k.key === defaultSortAttrsKey,
  );
  if (grouped) return `group:${formatProgressGroupKey(grouped)}`;
  return metaKeys.includes(defaultSortAttrsKey) ? `meta:${defaultSortAttrsKey}` : null;
}

export type ProgressSortKey =
  | 'firstResid'
  | 'groupLabel'
  | 'listCount'
  | 'completedCount'
  | 'responseRate'
  | `meta:${string}`
  // group:<직렬화된 분류 키> — 배열 인덱스가 아닌 안정 식별자 (칩 on/off 재인덱싱에 불변)
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
   * 제외 사유별 내역 — 서로 겹치지 않는 버킷이라 둘의 합이 `excludedTotal` 과 같다.
   * 수신거부는 모집단 제외 사유가 아니다 (2026-08-27 결정 — 분모 유지).
   * 행 단위 합산(computeTotals)에는 사유 정보가 없어 0 으로 남는다.
   */
  excludedScreenedOut: number;
  excludedNegativeCode: number;
}

/** 조사 대상 0건 등 집계를 돌릴 필요가 없을 때 쓰는 빈 합계. */
/** 고정 정렬 키 5종 — meta:·group: 접두 키는 호출부가 후보 목록으로 넘긴다. */
const FIXED_SORT_KEYS: readonly ProgressSortKey[] = [
  'firstResid',
  'groupLabel',
  'listCount',
  'completedCount',
  'responseRate',
];

/**
 * `?sort=` 해석 — 알 수 없는 값은 응답률로 접는다 (운영 콘솔·게스트 콘솔 공용).
 *
 * 두 화면이 같은 표를 그리므로 해석도 하나여야 한다. 갈리면 한쪽에서만 통하는 정렬 키가
 * 생기고, 그 표의 헤더는 눌러도 아무 일이 없는 죽은 컨트롤이 된다.
 */
export function parseProgressSort(
  raw: string | undefined,
  metaKeys: readonly string[],
  groupKeys: readonly string[],
): ProgressSortKey {
  if (!raw) return 'responseRate';
  if (FIXED_SORT_KEYS.includes(raw as ProgressSortKey)) return raw as ProgressSortKey;
  if (raw.startsWith('meta:') && metaKeys.includes(raw.slice(5))) return raw as ProgressSortKey;
  if (raw.startsWith('group:') && groupKeys.includes(raw.slice(6))) return raw as ProgressSortKey;
  return 'responseRate';
}

/**
 * `?groupBy=` 해석 — 미지정이면 기본 켜짐 기준 전체(`defaultOff` 가 아닌 것), 콤마 목록이면 그중 유효한 것만.
 *
 * 유효 키가 하나도 없으면 기본으로 되돌린다(칩이 전부 꺼진 화면을 만들지 않는다).
 * 순서는 언제나 기준 목록 순서다 — URL 이 클릭 순서에 좌우되지 않게 한다.
 * 요청 키는 태그 키로 읽었다가 다시 직렬화해 비교한다 — 모르는 시스템 키(`system:…`)는 여기서 버려진다.
 */
export function resolveActiveGroupKeys<T extends { key: string; defaultOff?: boolean }>(
  criteria: readonly T[],
  raw: string | undefined,
): T[] {
  const defaults = criteria.filter((c) => !c.defaultOff);
  if (typeof raw !== 'string') return defaults;
  const requested = raw
    .split(',')
    .map((key) => parseProgressGroupKey(key.trim()))
    .filter((key): key is ProgressGroupKey => key !== null)
    .map(formatProgressGroupKey);
  const matched = criteria.filter((c) => requested.includes(c.key));
  return matched.length > 0 ? matched : defaults;
}

export const EMPTY_PROGRESS_TOTALS: ProgressTotals = {
  groupCount: 0,
  listTotal: 0,
  completedTotal: 0,
  excludedTotal: 0,
  excludedScreenedOut: 0,
  excludedNegativeCode: 0,
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
    },
  );
}
