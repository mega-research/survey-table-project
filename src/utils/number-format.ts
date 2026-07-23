/**
 * 숫자 입력의 화면 표시 포맷 헬퍼 (천단위 콤마, 단위 환산 한글 읽기, 범위/자릿수 판정).
 *
 * 여기 함수들은 전부 "표시 전용" — 응답 저장값(raw 숫자 문자열)을 변형하지 않는다.
 * 파싱은 utils/numeric-input.ts 의 엄격 파서를 그대로 사용한다.
 */

import type { NumberFormat, NumberUnit } from '@/types/survey';
import { isPartialNumericInput, parseNumericInput } from '@/utils/numeric-input';

/** 단위 → 배수. percent 는 배수 개념이 없어 null (환산 표시 없음). */
export const UNIT_MULTIPLIERS: Record<NumberUnit, number | null> = {
  one: 1,
  thousand: 1e3,
  tenThousand: 1e4,
  million: 1e6,
  tenMillion: 1e7,
  hundredMillion: 1e8,
  percent: null,
};

/** 빌더 select 라벨용 단위 표기 */
export const UNIT_LABELS: Record<NumberUnit, string> = {
  one: '일',
  thousand: '천',
  tenThousand: '만',
  million: '백만',
  tenMillion: '천만',
  hundredMillion: '억',
  percent: '%',
};

/** display 문자열에서 콤마만 제거해 raw 로 복원 */
export function stripComma(display: string): string {
  return display.replace(/,/g, '');
}

/**
 * raw 숫자 문자열(타이핑 중 부분 입력 포함)의 정수부에만 천단위 콤마 삽입.
 * 숫자 진행 상태가 아닌 문자열은 그대로 반환한다.
 */
export function formatWithComma(raw: string): string {
  if (!isPartialNumericInput(raw)) return raw;
  const neg = raw.startsWith('-');
  const body = neg ? raw.slice(1) : raw;
  const dotIdx = body.indexOf('.');
  const intPart = dotIdx === -1 ? body : body.slice(0, dotIdx);
  const rest = dotIdx === -1 ? '' : body.slice(dotIdx);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + rest;
}

/**
 * min 도달이 불가능한 "시작 입력"인지 — 타이핑 차단용.
 * - min >= 1: '0'/'.' 시작 차단 — 이어 쳐도 0.xxx 대라 min 에 도달 불가
 *   ('10' 처럼 도달 가능한 중간값 '1' 은 여기 걸리지 않고 그대로 허용된다)
 * - min >= 0: '-' 시작 차단 — 음수는 자릿수를 더해도 min 미만
 * 0 < min < 1 (예: 0.5) 은 '0.' 시작이 필요하므로 0 시작을 차단하지 않는다.
 */
export function violatesMinStart(raw: string, min: number | undefined): boolean {
  if (min === undefined || raw === '') return false;
  if (min >= 0 && raw.startsWith('-')) return true;
  if (min >= 1 && (raw.startsWith('0') || raw.startsWith('.'))) return true;
  return false;
}

/** 완성 숫자가 max 초과인지. 부분 입력('-', '.', '')과 max 미설정은 false. */
export function exceedsMax(raw: string, max: number | undefined): boolean {
  if (max === undefined) return false;
  const n = parseNumericInput(raw);
  return n !== null && n > max;
}

/** 소수 자릿수 초과 여부. places=0 이면 소수점 문자 자체를 거부한다. */
export function exceedsDecimalPlaces(raw: string, places: number | undefined): boolean {
  if (places === undefined) return false;
  const dotIdx = raw.indexOf('.');
  if (dotIdx === -1) return false;
  if (places === 0) return true;
  return raw.length - dotIdx - 1 > places;
}

/**
 * min/max 범위 위반 메시지 — blur 힌트와 "다음"/제출 차단 검증이 공유한다.
 * max 는 타이핑에서 차단되는 게 원칙이지만 emptyDefault 오설정·레거시 응답의 우회 값을 봉합한다.
 * 빈 값·부분 입력은 null (미응답 차단은 required 소관).
 */
export function rangeViolationMessage(
  raw: string,
  format: NumberFormat | null | undefined,
): string | null {
  if (!format) return null;
  const n = parseNumericInput(raw);
  if (n === null) return null;
  if (format.min !== undefined && n < format.min) return `${format.min} 이상 입력해주세요`;
  if (format.max !== undefined && n > format.max) return `${format.max} 이하로 입력해주세요`;
  return null;
}

// ── 한글 환산 읽기 ──────────────────────────────────────────────────────────

const GROUP_UNITS: Array<{ value: number; label: string }> = [
  { value: 1e12, label: '조' },
  { value: 1e8, label: '억' },
  { value: 1e4, label: '만' },
];

/**
 * 그룹 내부 값(1~9999)의 읽기: 천/백 자리는 "N천 N백" 으로 분해하고
 * 마지막 두 자리(십·일)는 숫자 그대로 붙인다.
 * 예: 3000 → "3천", 2500 → "2천 5백", 12 → "12", 2345 → "2천 3백 45"
 */
function readGroup(n: number): string {
  const parts: string[] = [];
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (thousands > 0) parts.push(`${thousands}천`);
  if (hundreds > 0) parts.push(`${hundreds}백`);
  if (rest > 0) parts.push(String(rest));
  return parts.join(' ');
}

/**
 * raw 입력값에 단위 배수를 적용한 총량의 한글 읽기.
 * 예: unit='tenMillion', raw='123' → "12억 3천만" / unit='one', raw='123456' → "12만 3,456"
 * 만/억/조 그룹 내부는 천/백 분해(readGroup), 만 미만 잔여는 콤마 숫자로 표기한다.
 * percent·기본(undefined) 단위, 부분 입력, 0 은 null.
 * 일(one) 단위는 만 미만 값이면 입력 숫자 재표기일 뿐이라 null (표시하지 않음).
 */
export function formatKoreanUnitReading(
  raw: string,
  unit: NumberUnit | undefined,
): string | null {
  if (!unit) return null;
  const multiplier = UNIT_MULTIPLIERS[unit];
  if (multiplier === null) return null;
  const n = parseNumericInput(raw);
  if (n === null || n === 0) return null;

  const neg = n < 0;
  const total = Math.abs(n) * multiplier;
  if (unit === 'one' && total < 1e4) return null;
  let intPart = Math.floor(total);
  const frac = total - intPart;

  const parts: string[] = [];
  for (const { value, label } of GROUP_UNITS) {
    const g = Math.floor(intPart / value);
    if (g > 0) parts.push(`${readGroup(g)}${label}`);
    intPart -= g * value;
  }
  // 만 미만 잔여 — 콤마 숫자로 표기 (소수부 포함)
  if (frac > 0) {
    parts.push(formatWithComma(String(Math.round((intPart + frac) * 1e9) / 1e9)));
  } else if (intPart > 0) {
    parts.push(formatWithComma(String(intPart)));
  }
  if (parts.length === 0) return null;
  return (neg ? '-' : '') + parts.join(' ');
}
