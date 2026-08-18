import {
  HEADER_FILTER_MODES,
  HEADER_FILTER_VALUE_SEPARATOR,
  type HeaderFilterMode,
} from './filter-shared';

/**
 * 헤더 필터 URL 직렬화 헬퍼 — 클라이언트(드롭다운/필터바)와 테스트가 공유하는
 * 순수 모듈. server-only 의존 없음.
 *
 * URL 스킴: hcol[]/hm[]/hv[] 병렬 배열 (빌더의 col[]/q[]/op[] 와 동형).
 * in 모드의 hv 는 HEADER_FILTER_VALUE_SEPARATOR 로 조인된 값 목록.
 *
 * 상호배타 규칙: 헤더 필터 적용(upsertHeaderFilter)은 빌더 파라미터를 전부
 * 제거한다. 반대 방향(빌더 검색 시 hcol/hm/hv 제거)은 필터바가 수행한다.
 * 경고 다이얼로그 여부는 컴포넌트가 결정하고, 실제 제거는 여기서 일관 수행.
 */

export interface HeaderFilterEntry {
  source: string;
  mode: HeaderFilterMode;
  /** 직렬화된 값 — in 모드는 구분자 조인 목록, text/exact 는 원문. */
  hv: string;
}

export function parseHeaderFilterEntries(params: URLSearchParams): HeaderFilterEntry[] {
  const cols = params.getAll('hcol');
  const modes = params.getAll('hm');
  const hvs = params.getAll('hv');
  const len = Math.min(cols.length, modes.length, hvs.length);
  const entries: HeaderFilterEntry[] = [];
  for (let i = 0; i < len; i++) {
    const source = cols[i];
    const mode = modes[i];
    const hv = hvs[i];
    if (source === undefined || mode === undefined || hv === undefined) continue;
    if (!(HEADER_FILTER_MODES as readonly string[]).includes(mode)) continue;
    entries.push({ source, mode: mode as HeaderFilterMode, hv });
  }
  return entries;
}

function writeEntries(params: URLSearchParams, entries: HeaderFilterEntry[]): void {
  params.delete('hcol');
  params.delete('hm');
  params.delete('hv');
  for (const e of entries) {
    params.append('hcol', e.source);
    params.append('hm', e.mode);
    params.append('hv', e.hv);
  }
}

export function clearBuilderFilterParams(params: URLSearchParams): void {
  params.delete('col');
  params.delete('q');
  params.delete('op');
}

export function clearHeaderFilterParams(params: URLSearchParams): void {
  params.delete('hcol');
  params.delete('hm');
  params.delete('hv');
}

/**
 * 컬럼 하나의 헤더 필터 적용 — 같은 source 는 자리 교체, 새 source 는 append.
 * 필터 변경이므로 page 리셋 + 상호배타 규칙에 따라 빌더 파라미터 제거.
 */
export function upsertHeaderFilter(params: URLSearchParams, entry: HeaderFilterEntry): void {
  const entries = parseHeaderFilterEntries(params);
  const idx = entries.findIndex((e) => e.source === entry.source);
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  writeEntries(params, entries);
  clearBuilderFilterParams(params);
  params.delete('page');
}

/** 컬럼 하나의 헤더 필터 해제. 필터 변경이므로 page 리셋. */
export function removeHeaderFilter(params: URLSearchParams, source: string): void {
  const entries = parseHeaderFilterEntries(params).filter((e) => e.source !== source);
  writeEntries(params, entries);
  params.delete('page');
}

export function hasBuilderFilterParams(params: URLSearchParams): boolean {
  return params.getAll('col').length > 0 && params.getAll('q').length > 0;
}

export function hasHeaderFilterParams(params: URLSearchParams): boolean {
  return parseHeaderFilterEntries(params).length > 0;
}

export function joinHeaderValues(values: string[]): string {
  return values.join(HEADER_FILTER_VALUE_SEPARATOR);
}

export function splitHeaderValues(hv: string): string[] {
  return hv.split(HEADER_FILTER_VALUE_SEPARATOR).filter((v) => v.length > 0);
}
