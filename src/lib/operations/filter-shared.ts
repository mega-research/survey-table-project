import type { PiiFieldType } from '@/lib/crypto/pii-fields';

/**
 * 필터 source 문자열 상수 — 진척 보고/조사 대상 모듈 모두 공유.
 * 새 source 추가 시 한 곳에서만 갱신하면 모든 분기/검증/UI 가 따라간다.
 */
export const FILTER_SOURCE = {
  RESID: 'system.resid',
  CONTACT_RESULT: 'system.contact_result',
  WEB: 'system.web',
  ATTRS_PREFIX: 'attrs.',
  PII_PREFIX: 'pii.',
} as const;

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
 *                   조사 대상은 '검색어' (다른 위젯 분기 있어 일반화).
 */
export function placeholderFor(source: string | null, attrsLabel = '검색어'): string {
  if (!source) return '검색어';
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
