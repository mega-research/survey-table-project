/**
 * 입력 형식 파서 — 휴대전화 · 전화 · 사업자번호 · 법인번호 · 이메일.
 *
 * 검증 · 체크섬 · 하이픈 정규화 · 실패 사유가 **한 함수에서** 나온다. 따로 두면
 * "통과했는데 정규형이 없다" 처럼 서로 어긋난다.
 *
 * **정규식이 아니라 파서인 이유**
 * 1. 체크섬은 정규식으로 못 한다 — 사업자·법인번호는 자릿수별 가중치 산술이다.
 * 2. 하이픈 위치를 정하려면 번호를 해석해야 한다 — 지역번호가 02(2자리)와 031(3자리)로
 *    갈리고 국번이 3~4자리다.
 * 3. 정규식은 실패 사유를 못 알려준다 — "10자리가 아닙니다"와 "확인번호가 맞지 않습니다"는
 *    응답자에게 전혀 다른 안내다.
 *
 * 국제번호 라이브러리(libphonenumber 류)는 쓰지 않는다 — 국내 조사에는 과하고 번들만 무겁다.
 */
import type { InputFormat } from '@/types/input-type';

export type FormatFailure =
  | 'wrong_length'
  | 'not_a_number'
  | 'unknown_prefix' // 휴대전화 식별번호·지역번호가 아님
  | 'checksum_mismatch'
  | 'malformed'; // 이메일 구조 불량

export type ParseResult = { ok: true; normalized: string } | { ok: false; reason: FormatFailure };

/**
 * 이동통신 식별번호. 010 은 8자리 가입자번호가 원칙이지만 7자리도 받는다 —
 * 번호 정책보다 응답자를 막지 않는 쪽을 택한다(체계상 없는 번호는 통신사가 거른다).
 */
const MOBILE_PREFIXES = ['010', '011', '016', '017', '018', '019'] as const;

/**
 * 유선 지역번호 3자리 + 인터넷전화(070). 서울(02)은 2자리라 따로 본다.
 * 대표번호(15xx·16xx·18xx)와 안심번호(050x)는 **일부러 뺐다** — 자릿수·형태가 제각각이라
 * 정규형을 정할 수 없다. 담당자가 정당한 예외로 넣어야 할 값은 관리자 편집에서 경고로 통과한다.
 */
const LANDLINE_AREA_CODES = [
  '031',
  '032',
  '033', // 경기·인천·강원
  '041',
  '042',
  '043',
  '044', // 충남·대전·충북·세종
  '051',
  '052',
  '053',
  '054',
  '055', // 부산·울산·대구·경북·경남
  '061',
  '062',
  '063',
  '064', // 전남·광주·전북·제주
  '070', // 인터넷전화
] as const;

/** 표기용 구분 문자 — 공백·하이픈류·괄호·점. 이것만 걷어내고 남은 것이 숫자가 아니면 실패다. */
const SEPARATOR_PATTERN = /[\s\-–—().]/g;

function digitsOf(raw: string): string | null {
  const stripped = raw.replace(SEPARATOR_PATTERN, '');
  return /^[0-9]+$/.test(stripped) ? stripped : null;
}

/** 모든 자리가 같은 숫자 — 체크섬을 우연히 통과하는 명백한 오타(0000000000)를 거른다. */
function isRepeatedDigit(digits: string): boolean {
  return new Set(digits).size === 1;
}

/** 국번 3자리(`123-4567`) 또는 4자리(`1234-5678`) 로 쪼갠다. 나머지 자릿수는 호출부가 이미 걸렀다. */
function splitSubscriber(rest: string): string {
  return rest.length === 7
    ? `${rest.slice(0, 3)}-${rest.slice(3)}`
    : `${rest.slice(0, 4)}-${rest.slice(4)}`;
}

function parseMobile(digits: string): ParseResult {
  const prefix = MOBILE_PREFIXES.find((p) => digits.startsWith(p));
  if (!prefix) return { ok: false, reason: 'unknown_prefix' };
  const rest = digits.slice(prefix.length);
  if (rest.length !== 7 && rest.length !== 8) return { ok: false, reason: 'wrong_length' };
  return { ok: true, normalized: `${prefix}-${splitSubscriber(rest)}` };
}

function parsePhone(digits: string): ParseResult {
  if (MOBILE_PREFIXES.some((p) => digits.startsWith(p))) return parseMobile(digits);
  const area = digits.startsWith('02')
    ? '02'
    : LANDLINE_AREA_CODES.find((c) => digits.startsWith(c));
  if (!area) return { ok: false, reason: 'unknown_prefix' };
  const rest = digits.slice(area.length);
  if (rest.length !== 7 && rest.length !== 8) return { ok: false, reason: 'wrong_length' };
  return { ok: true, normalized: `${area}-${splitSubscriber(rest)}` };
}

/**
 * 사업자등록번호 체크섬 — 앞 9자리에 가중치 [1,3,7,1,3,7,1,3,5] 를 곱해 더하고,
 * 9번째 자리(가중치 5)의 곱은 10으로 나눈 몫을 한 번 더 더한다. 10의 보수가 마지막 자리다.
 */
function bizChecksumDigit(digits: string): number {
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * (weights[i] as number);
  sum += Math.floor((Number(digits[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10;
}

function parseBizNumber(digits: string): ParseResult {
  if (digits.length !== 10) return { ok: false, reason: 'wrong_length' };
  if (isRepeatedDigit(digits) || bizChecksumDigit(digits) !== Number(digits[9])) {
    return { ok: false, reason: 'checksum_mismatch' };
  }
  return {
    ok: true,
    normalized: `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`,
  };
}

/**
 * 법인등록번호 체크섬 — 앞 12자리에 가중치 1,2 를 번갈아 곱해 더하고 10의 보수가 마지막 자리다.
 */
function corpChecksumDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 2);
  return (10 - (sum % 10)) % 10;
}

function parseCorpNumber(digits: string): ParseResult {
  if (digits.length !== 13) return { ok: false, reason: 'wrong_length' };
  if (isRepeatedDigit(digits) || corpChecksumDigit(digits) !== Number(digits[12])) {
    return { ok: false, reason: 'checksum_mismatch' };
  }
  return { ok: true, normalized: `${digits.slice(0, 6)}-${digits.slice(6)}` };
}

/**
 * 이메일 — 구조 검사까지만 한다. RFC 5322 를 정규식으로 완전히 검증하는 것은 불가능하고,
 * 실무 표준도 구조 검사 수준이다(`normalizePii` 가 이미 같은 선에 있다).
 * 저장은 소문자 원문 — 하이픈 정규형이 없는 유일한 형식이다.
 */
function parseEmail(raw: string): ParseResult {
  const value = raw.trim().toLowerCase();
  if (/\s/.test(value)) return { ok: false, reason: 'malformed' };
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  const domain = value.slice(at + 1);
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((label) => label.length === 0)) {
    return { ok: false, reason: 'malformed' };
  }
  return { ok: true, normalized: value };
}

/**
 * 값 하나를 형식에 비추어 본다.
 *
 * **빈 값은 검사하지 않는다** — 필수 여부는 호출부(문항·셀의 required)가 판단한다.
 * 여기서 빈 값을 실패로 내면 필수가 아닌 칸도 비울 수 없게 된다.
 */
export function parseInputFormat(format: InputFormat, raw: string): ParseResult {
  if (raw.trim() === '') return { ok: true, normalized: '' };
  if (format === 'email') return parseEmail(raw);

  const digits = digitsOf(raw.trim());
  if (digits === null) return { ok: false, reason: 'not_a_number' };

  switch (format) {
    case 'mobile':
      return parseMobile(digits);
    case 'phone':
      return parsePhone(digits);
    case 'biz_number':
      return parseBizNumber(digits);
    case 'corp_number':
      return parseCorpNumber(digits);
  }
}
