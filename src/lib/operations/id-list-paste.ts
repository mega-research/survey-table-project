import { FILTER_SOURCE, decodeMultiClauseValue, parseIdListToken } from './filter-shared';
import {
  type NumRange,
  type Parity,
  SINGLE_COLUMN_ID_LIST_MAX,
  compactIdList,
  countDistinctIds,
  hasLeadingZeroToken,
  parseIdListDetailed,
  parseParityKeyword,
} from './range-list';

/**
 * 필터 입력칸의 ID 목록 붙여넣기 — 클라이언트(위젯·필터바)와 테스트가 공유하는 순수 모듈.
 * 서버 파서(read-models/contacts-filter-parse)와 같은 range-list 파서를 쓰므로 화면의 판정과
 * 실제 검색 결과가 어긋나지 않는다.
 */

/** 붙여넣기 ID 목록을 받는 컬럼 — 시스템ID 와 attrs.* (pii·상태 컬럼은 텍스트/선택). */
export function isIdListSource(source: string): boolean {
  return source === FILTER_SOURCE.RESID || source.startsWith(FILTER_SOURCE.ATTRS_PREFIX);
}

/**
 * 엑셀 열/행 복사(개행·탭 구분)를 공백 구분 한 줄로. URL 의 q 에는 공백이 `+` 1바이트라
 * 개행(%0A, 3바이트)보다 목록이 작게 실린다.
 */
export function normalizePastedIdList(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** 저장용 정수 목록 전개 — 단건은 그대로, 범위는 펼친다. 상한을 넘으면 null. */
export function expandRangesToIds(ranges: NumRange[], max: number): number[] | null {
  const ids: number[] = [];
  for (const r of ranges) {
    if (ids.length + (r.to - r.from + 1) > max) return null;
    for (let n = r.from; n <= r.to; n++) ids.push(n);
  }
  return ids;
}

export type IdListStatus =
  | { kind: 'none' }
  /** 저장된 목록 토큰 — count 는 토큰 접미사 (없으면 null) */
  | { kind: 'token'; count: number | null }
  /** `짝수`/`홀수` 한 단어 — 번호 홀짝으로 건다 */
  | { kind: 'parity'; parity: Parity }
  /**
   * 번호 2개 이상 인식 — count 는 토큰 수(인라인 상한 판정), ids 는 겹침을 뺀 실제 번호 수
   * (구간 `1-100` 은 토큰 1·번호 100). overLimit 면 검색 시 저장 경로로 간다
   */
  | { kind: 'list'; count: number; ids: number; duplicates: number; overLimit: boolean }
  /** 숫자 아닌 토큰이 섞임 — 검색 전에 고치도록 경고 */
  | { kind: 'invalid'; count: number; invalid: string[] }
  /** attrs 목록에 선행 0 번호("0001")가 섞임 — 서버가 숫자로 접지 않아 목록 검색 불가 */
  | { kind: 'leadingZero'; tokens: string[] };

/**
 * 입력값 → 배지/경고 판정.
 * - 시스템ID: 숫자 아닌 토큰이 하나라도 있으면 invalid (resid 는 항상 숫자).
 * - attrs: 숫자가 2개 이상 섞였을 때만 invalid — "메가 리서치" 같은 일반 텍스트 검색은 none.
 * - 번호 하나는 none — 단일 값 검색은 종전 그대로라 배지가 소음이다. 구간 하나(`1-100`)는
 *   번호가 여럿이라 list — 연속 번호를 구간으로 합친 뒤에도 실제 번호 수가 보여야 한다.
 * - attrs 목록에 선행 0 번호가 섞이면 leadingZero — 서버(hasLeadingZeroToken)가 텍스트 검색으로
 *   보내 목록 전체가 0건이 되므로 검색 전에 알린다. 단일 값 "0001" 은 텍스트 검색으로 맞으니 none.
 */
export function describeIdListValue(source: string, value: string): IdListStatus {
  if (!isIdListSource(source)) return { kind: 'none' };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { kind: 'none' };
  const token = parseIdListToken(trimmed);
  if (token) return { kind: 'token', count: token.count };
  const parity = parseParityKeyword(trimmed);
  if (parity) return { kind: 'parity', parity };
  const r = parseIdListDetailed(trimmed, { maxTokens: SINGLE_COLUMN_ID_LIST_MAX });
  if (r.invalid.length > 0) {
    const looksLikeList = source === FILTER_SOURCE.RESID || r.count >= 2;
    return looksLikeList
      ? { kind: 'invalid', count: r.count, invalid: r.invalid }
      : { kind: 'none' };
  }
  const ids = countDistinctIds(r.ranges);
  if (ids < 2) return { kind: 'none' };
  if (source !== FILTER_SOURCE.RESID && hasLeadingZeroToken(trimmed)) {
    // 토큰 하나("010-1234", "0001")는 서버가 텍스트 검색으로 받아 그대로 맞는다 — 목록이 아니다.
    if (r.count < 2) return { kind: 'none' };
    const tokens = trimmed.split(/[\s,;]+/).filter((t) => /(^|-)0\d/.test(t));
    return { kind: 'leadingZero', tokens };
  }
  return { kind: 'list', count: r.count, ids, duplicates: r.duplicates, overLimit: r.overLimit };
}

/**
 * 조건 줄 값의 연속 번호를 `1-100, 200-300` 구간으로 합친다 (컨택원 수정 화면) — 고르는 대상은
 * 같다(`compactIdList`). 목록 칸이 아닌 열, 오른쪽 값 목록에서 고른 여러 값(구분자 형식)은 손대지 않는다.
 */
export function compactIdListValue(source: string, value: string): string {
  if (!isIdListSource(source) || decodeMultiClauseValue(value) !== null) return value;
  return compactIdList(value);
}
