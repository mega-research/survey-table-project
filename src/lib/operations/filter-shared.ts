import type { PiiFieldType } from '@/lib/crypto/pii-fields';

/**
 * 필터 source 문자열 상수 — 진척 보고/조사 대상 모듈 모두 공유.
 * 새 source 추가 시 한 곳에서만 갱신하면 모든 분기/검증/UI 가 따라간다.
 */
export const FILTER_SOURCE = {
  /** 전체 컬럼 검색 — 표시 중인 attrs ILIKE + pii blindIndex exact 를 OR 로 전개. */
  ALL: 'system.all',
  RESID: 'system.resid',
  CONTACT_RESULT: 'system.contact_result',
  WEB: 'system.web',
  ATTRS_PREFIX: 'attrs.',
  PII_PREFIX: 'pii.',
} as const;

/**
 * 헤더 필터(hv 파라미터)에서 in 모드 값 목록을 조인하는 구분자.
 * unit separator — 엑셀 셀 텍스트에 등장할 가능성이 사실상 없는 제어 문자.
 * 클라이언트(드롭다운 직렬화)와 서버(parseHeaderFiltersFromUrl)가 공유한다.
 */
export const HEADER_FILTER_VALUE_SEPARATOR = '\u001f';

/** 헤더 필터 URL hm 파라미터가 가질 수 있는 모드. */
export const HEADER_FILTER_MODES = ['in', 'text', 'exact'] as const;
export type HeaderFilterMode = (typeof HEADER_FILTER_MODES)[number];

/**
 * ILIKE wildcard escape — `%` `_` `\` 를 리터럴로 처리.
 * profiles.server.ts / report-progress.server.ts / contacts.server.ts 가 공유.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * source 종류 → input placeholder 텍스트.
 *
 * @param attrsLabel attrs.* 등 텍스트 매칭 컬럼의 placeholder. 진척 보고는 '부분일치',
 *                   조사 대상 기본값은 범위 검색 힌트 포함 (NO 등 숫자 컬럼 범위 검색 안내).
 */
export function placeholderFor(
  source: string | null,
  attrsLabel = '검색어 또는 범위 (예: 10-13)',
): string {
  if (!source) return '검색어';
  if (source === FILTER_SOURCE.ALL) return '전체 검색 (암호화 컬럼은 전문 일치)';
  if (source === FILTER_SOURCE.RESID) return '예: 1-30, 45';
  if (source.startsWith(FILTER_SOURCE.PII_PREFIX)) return '정확한 값 입력 (부분 검색 불가)';
  return attrsLabel;
}

/** 필터 컬럼 후보 기본 타입 — client 컴포넌트가 사용. */
export interface ColumnCandidate {
  source: string;
  label: string;
}

/** 서버 모듈에서 pii blindIndex 계산을 위해 piiType 포함. */
export interface ColumnCandidateWithPii extends ColumnCandidate {
  piiType?: PiiFieldType;
}
