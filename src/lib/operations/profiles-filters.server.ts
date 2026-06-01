import 'server-only';

import {
  parseConditionFromUrl,
  type ColumnCandidate,
  type FilterCondition,
} from './progress-filters.server';

/**
 * 응답 내역 필터 조건. 진척률 FilterCondition(resid/attrs/pii) + 응답 자체 컬럼 2종.
 *  - idx: survey_responses row_number (응답 순번). 정확 매치.
 *  - browser: survey_responses.browser. ilike 부분일치.
 */
export type ProfilesCondition =
  | { source: 'idx'; mode: 'idx'; value: number }
  | { source: 'browser'; mode: 'text'; value: string }
  | FilterCondition;

/** 응답 전용 추가 컬럼 후보 — 명단 후보 앞에 노출. */
export const PROFILES_EXTRA_CANDIDATES: ColumnCandidate[] = [
  { source: 'idx', label: '순번' },
  { source: 'browser', label: '브라우저' },
];

/**
 * col/q → ProfilesCondition. idx/browser 는 응답 전용 분기, 그 외는 진척률 파서 위임.
 *
 * idx 비숫자 입력은 value=0 으로 반환한다. row_number 는 항상 1 이상이라 `idx = 0` 은
 * 0건 — "순번으로 검색했으나 숫자가 아님 → 결과 없음" 의미를 명시적으로 표현(전체 노출 방지).
 */
export function parseProfilesCondition(
  col: string | null,
  q: string | null,
  candidates: ColumnCandidate[],
): ProfilesCondition | null {
  if (!col) return null;
  const trimmed = (q ?? '').trim();
  if (trimmed.length === 0) return null;

  if (col === 'idx') {
    const n = parseInt(trimmed, 10);
    return { source: 'idx', mode: 'idx', value: Number.isFinite(n) && n > 0 ? n : 0 };
  }

  if (col === 'browser') {
    return { source: 'browser', mode: 'text', value: trimmed };
  }

  return parseConditionFromUrl(col, q, candidates);
}
