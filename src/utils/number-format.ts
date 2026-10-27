/**
 * 숫자 입력의 화면 표시 포맷 헬퍼 (천단위 콤마, 단위 환산 한글 읽기, 범위/자릿수 판정).
 *
 * 여기 함수들은 전부 "표시 전용" — 응답 저장값(raw 숫자 문자열)을 변형하지 않는다.
 * 파싱은 utils/numeric-input.ts 의 엄격 파서를 그대로 사용한다.
 */

import type { NumberFormat, NumberUnit } from '@/types/survey';
import { DEFAULT_SURVEY_LOCALE, type SurveyLocale } from '@/types/survey-locale';
import { isPartialNumericInput, parseNumericInput } from '@/utils/numeric-input';
import { systemText } from '@/utils/system-strings';

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
 * 허용값 제한이 있을 때 현재 타이핑 값을 받아들일지 판정한다.
 * 완성값뿐 아니라 여러 자리 숫자를 입력하기 위한 접두 입력도 허용한다.
 * 예: allowed=[10, 20]이면 '', '1', '10', '2', '20'은 허용하고 '3'은 거부.
 */
export function canInputAllowedValue(raw: string, allowedValues: number[] | undefined): boolean {
  if (!allowedValues || allowedValues.length === 0 || raw === '') return true;
  return allowedValues.some((value) => String(value).startsWith(raw));
}

/**
 * min/max 범위 위반 메시지 — blur 힌트와 "다음"/제출 차단 검증이 공유한다.
 * max 는 타이핑에서 차단되는 게 원칙이지만 emptyDefault 오설정·레거시 응답의 우회 값을 봉합한다.
 * 빈 값·부분 입력은 null (미응답 차단은 required 소관). 문구는 현재 언어(기본 한국어)를 따른다.
 */
export function rangeViolationMessage(
  raw: string,
  format: NumberFormat | null | undefined,
  locale: SurveyLocale = DEFAULT_SURVEY_LOCALE,
): string | null {
  if (!format) return null;
  const n = parseNumericInput(raw);
  if (n === null) return null;
  if (format.min !== undefined && n < format.min) {
    return systemText('validation.range.min', locale, { min: format.min });
  }
  if (format.max !== undefined && n > format.max) {
    return systemText('validation.range.max', locale, { max: format.max });
  }
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
 *
 * suffix(단위 어절 — 원, kg, t 등)가 있으면 읽기 끝에 그대로 이어 붙인다
 * (예: unit='million', raw='123.45', suffix='원' → "1억 2천 3백 45만원").
 * 어절만 있고 환산 읽기가 없는 경우(기본 단위, 일 단위 만 미만)에는 콤마 숫자 + 어절로
 * 표기해 단위 어절이 항상 보이게 한다. percent 는 어절 대상이 아니다.
 */
export function formatKoreanUnitReading(
  raw: string,
  unit: NumberUnit | undefined,
  suffix?: string | undefined,
): string | null {
  const sfx = (suffix ?? '').trim();
  const commaWithSuffix = (): string | null => {
    if (!sfx) return null;
    const parsed = parseNumericInput(raw);
    if (parsed === null || parsed === 0) return null;
    return formatWithComma(raw) + sfx;
  };
  if (!unit) return commaWithSuffix();
  const multiplier = UNIT_MULTIPLIERS[unit];
  if (multiplier === null) return null;
  const n = parseNumericInput(raw);
  if (n === null || n === 0) return null;

  const neg = n < 0;
  const total = Math.abs(n) * multiplier;
  if (unit === 'one' && total < 1e4) return commaWithSuffix();
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
  return (neg ? '-' : '') + parts.join(' ') + sfx;
}

// ── 언어별 읽기 (다국어 설문) ───────────────────────────────────────────────

/** 중국어 끊어 읽기 — 亿·万 으로 끊고 묶음 안은 숫자 그대로 (1,500,000,000,000 → 1万5000亿) */
function readChinese(n: number): string {
  if (n >= 1e8) {
    const rest = n % 1e8;
    return `${readChinese(Math.floor(n / 1e8))}亿${rest > 0 ? readChinese(rest) : ''}`;
  }
  if (n >= 1e4) {
    const rest = n % 1e4;
    return `${Math.floor(n / 1e4)}万${rest > 0 ? String(rest) : ''}`;
  }
  return String(n);
}

const ENGLISH_SCALES: Array<{ value: number; label: string }> = [
  { value: 1e12, label: 'trillion' },
  { value: 1e9, label: 'billion' },
  { value: 1e6, label: 'million' },
];

/** 영어 읽기 — 백만 이상만 million·billion·trillion 으로, 소수 둘째 자리까지 (1,111,111 → 1.11 million) */
function readEnglish(total: number): string | null {
  for (let i = ENGLISH_SCALES.length - 1; i >= 0; i--) {
    const scale = ENGLISH_SCALES[i]!;
    const next = ENGLISH_SCALES[i - 1];
    if (total < scale.value) continue;
    const rounded = Number((total / scale.value).toFixed(2));
    // 999,999,999 가 「1000 million」 이 되지 않게 반올림 뒤 1000 이면 다음 단위로
    if (next && rounded >= 1000 && total < next.value) {
      return `${Number((total / next.value).toFixed(2))} ${next.label}`;
    }
    if (next && total >= next.value) continue;
    return `${rounded} ${scale.label}`;
  }
  return null;
}

/**
 * 입력칸 아래 읽기 — 현재 언어를 따른다. 한국어(기본)는 `formatKoreanUnitReading` 그대로라 다국어가 아닌
 * 설문은 한 글자도 바뀌지 않는다. 중국어는 万·亿 로 끊고(`111万1111元`), 영어는 백만 이상을
 * million·billion·trillion 으로 읽고 어절 앞을 띄운다(`1.11 million USD`). 만(영어는 백만) 미만은 세 언어 모두
 * 콤마 숫자 + 어절이고, 0·빈 값·부분 입력·percent 는 null 이다.
 */
export function formatUnitReading(
  raw: string,
  unit: NumberUnit | undefined,
  suffix?: string | undefined,
  locale: SurveyLocale = DEFAULT_SURVEY_LOCALE,
): string | null {
  if (locale === 'ko') return formatKoreanUnitReading(raw, unit, suffix);
  const sfx = (suffix ?? '').trim();
  const join = (body: string) => (locale === 'en' && sfx ? `${body} ${sfx}` : body + sfx);
  const n = parseNumericInput(raw);
  if (n === null || n === 0) return null;
  const commaWithSuffix = () => (sfx ? join(formatWithComma(raw)) : null);
  if (!unit) return commaWithSuffix();
  const multiplier = UNIT_MULTIPLIERS[unit];
  if (multiplier === null) return null;

  const total = Math.abs(n) * multiplier;
  const sign = n < 0 ? '-' : '';
  const reading = locale === 'en' ? readEnglish(total) : total >= 1e4 ? '' : null;
  if (reading === null) {
    // 끊어 읽을 만큼 크지 않다 — 일 단위는 입력 그대로라 어절이 있을 때만, 배수 단위는 환산한 총량을 콤마로
    if (unit === 'one') return commaWithSuffix();
    return join(sign + formatWithComma(String(Math.round(total * 1e9) / 1e9)));
  }
  if (locale === 'en') return join(sign + reading);
  const intPart = Math.floor(total);
  const frac = Math.round((total - intPart) * 1e9) / 1e9;
  const fracText = frac > 0 ? String(frac).slice(1) : '';
  return join(sign + readChinese(intPart) + fracText);
}
