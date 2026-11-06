/**
 * 입력 형식 파서 — 휴대전화 · 전화 · 사업자번호 · 법인번호 · 이메일 · 날짜.
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
 * 해외 번호는 `+` 로 시작할 때만 받고 나라별 규칙 없이 길이만 본다(`parseInternational`).
 */
import type { InputFormat } from '@/types/input-type';
import { DEFAULT_SURVEY_LOCALE, type SurveyLocale } from '@/types/survey-locale';
import { type SystemStringKey, systemText } from '@/utils/system-strings';

export type FormatFailure =
  | 'wrong_length'
  | 'not_a_number'
  | 'unknown_prefix' // 휴대전화 식별번호·지역번호가 아님
  | 'checksum_mismatch'
  | 'malformed' // 이메일 구조 불량
  | 'non_ascii' // 이메일에 한글·전각 등 ASCII 밖 글자
  | 'invalid_date'; // 날짜 모양은 맞는데 달력에 없는 날(13월·2월 30일) 또는 범위 밖 연도

export type ParseResult = { ok: true; normalized: string } | { ok: false; reason: FormatFailure };

/**
 * 이동통신 식별번호. 010 은 8자리 가입자번호가 원칙이지만 7자리도 받는다 —
 * 번호 정책보다 응답자를 막지 않는 쪽을 택한다(체계상 없는 번호는 통신사가 거른다).
 */
const MOBILE_PREFIXES = ['010', '011', '016', '017', '018', '019'] as const;

/**
 * 유선 지역번호 3자리 + 인터넷전화(070) + 수신자 부담(080). 서울(02)은 2자리, 안심번호(050X)는
 * 4자리라 따로 본다. 대표번호는 아래 따로 본다.
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
  '080', // 수신자 부담
] as const;

/** 안심번호 0502~0508 — 4자리 식별번호 + 3·4자리 국번 + 4자리 */
const SAFE_NUMBER_PREFIX = /^050[2-8]/;

/**
 * 전국 대표번호(1588·1544·1600·1899 …) — 지역번호 없이 앞 4자리 + 뒤 4자리, 늘 8자리다.
 * 첫 두 자리 15·16·18 만 받는다(대표번호 대역). 사업체 전화로 대표번호만 가진 곳이 실제로 있어
 * 막으면 응답자가 넘어갈 수 없었다(2026-11-05, 유가공업 실태조사).
 */
const REPRESENTATIVE_PREFIXES = ['15', '16', '18'] as const;

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

function isRepresentative(digits: string): boolean {
  return REPRESENTATIVE_PREFIXES.some((p) => digits.startsWith(p));
}

function parsePhone(digits: string): ParseResult {
  if (MOBILE_PREFIXES.some((p) => digits.startsWith(p))) return parseMobile(digits);
  if (isRepresentative(digits)) {
    if (digits.length !== 8) return { ok: false, reason: 'wrong_length' };
    return { ok: true, normalized: `${digits.slice(0, 4)}-${digits.slice(4)}` };
  }
  const area = digits.startsWith('02')
    ? '02'
    : SAFE_NUMBER_PREFIX.test(digits)
      ? digits.slice(0, 4)
      : LANDLINE_AREA_CODES.find((c) => digits.startsWith(c));
  if (!area) return { ok: false, reason: 'unknown_prefix' };
  const rest = digits.slice(area.length);
  if (rest.length !== 7 && rest.length !== 8) return { ok: false, reason: 'wrong_length' };
  return { ok: true, normalized: `${area}-${splitSubscriber(rest)}` };
}

/** 국제 표준(E.164) 번호 길이 — 국가번호 포함 숫자만 */
const INTERNATIONAL_MIN_DIGITS = 8;
const INTERNATIONAL_MAX_DIGITS = 15;
const KOREA_COUNTRY_CODE = '82';

/**
 * 해외 번호 — 전화·휴대전화 칸에서 값이 `+` 로 시작할 때만 탄다(국내 번호는 `+` 로 시작하지 않아
 * 국내 응답에는 영향이 없다 — 2026-11-05 다국어 설문의 중·영판 자국 번호를 열려고 더했다).
 * - `+82` 는 국내 번호로 바꿔 국내 규칙(`domestic`)으로 검사·정돈한다. 국가번호 뒤에 0 을 붙여 쓴
 *   `+82 010…` 도 받는다. 대표번호(`+82 1588-1234` — 15·16·18 로 시작하는 **8자리**)는 앞에 0 을 붙이지
 *   않는다. 자릿수까지 봐야 한다 — `+82 16 123 4567` 은 016 휴대 번호다(2026-11-05 리뷰).
 * - 그 밖은 나라별 규칙 없이 숫자 8~15자리면 통과하고 `+` 와 숫자만으로 정돈한다. 국가번호는 0 으로
 *   시작하지 않는다.
 * 휴대전화 칸도 해외 번호는 휴대전화인지 가릴 수 없어 길이만 본다.
 */
function parseInternational(raw: string, domestic: (digits: string) => ParseResult): ParseResult {
  const digits = digitsOf(raw.slice(1));
  if (digits === null) return { ok: false, reason: 'not_a_number' };
  if (digits.startsWith(KOREA_COUNTRY_CODE)) {
    const national = digits.slice(KOREA_COUNTRY_CODE.length);
    const asDomestic =
      national.startsWith('0') || (national.length === 8 && isRepresentative(national))
        ? national
        : `0${national}`;
    return domestic(asDomestic);
  }
  if (digits.startsWith('0')) return { ok: false, reason: 'unknown_prefix' };
  if (digits.length < INTERNATIONAL_MIN_DIGITS || digits.length > INTERNATIONAL_MAX_DIGITS) {
    return { ok: false, reason: 'wrong_length' };
  }
  return { ok: true, normalized: `+${digits}` };
}

/**
 * 사업자·법인번호 체크섬 검사 스위치 — **2026-09-09 실사 중 끔.**
 *
 * 체크섬이 실사에서 너무 자주 정당한 응답을 막았다. 지금은 **자릿수와 하이픈 정돈만** 한다
 * (`1234567890` 처럼 형태만 맞는 값도 통과한다). 아래 체크섬 함수는 그대로 두었으니 이 상수를
 * `true` 로 돌리면 원래 규칙으로 복귀한다 — 지우지 말 것.
 *
 * 끄면 `checksum_mismatch` 는 나오지 않는다. 사유·문구는 남겨 둔다(다시 켜면 필요하고,
 * 켜고 끄는 것이 문구 표를 건드리는 일이 되면 안 된다).
 */
const ENFORCE_CHECKSUM: boolean = false;

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
  if (
    ENFORCE_CHECKSUM &&
    (isRepeatedDigit(digits) || bizChecksumDigit(digits) !== Number(digits[9]))
  ) {
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
  if (
    ENFORCE_CHECKSUM &&
    (isRepeatedDigit(digits) || corpChecksumDigit(digits) !== Number(digits[12]))
  ) {
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
  // 한글·전각 글자는 구조를 보기 전에 따로 잡는다 — "형식이 아닙니다"보다 "영문·숫자로"가
  // 고칠 방향을 알려 준다. 타이핑은 막지 않는다(한글 조합 중 글자를 떨어뜨리면 자판이 고장
  // 난 것처럼 보이고, 붙여넣기에서 조용히 다른 주소가 된다) — blur·다음에서 문구로 막는다.
  if (/\s/.test(value)) return { ok: false, reason: 'malformed' };
  if (/[^\x21-\x7e]/.test(value)) return { ok: false, reason: 'non_ascii' };
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

/** 받는 연도 범위 — 오타(0025·9999)를 거르는 선. 조사 대상 날짜(설립·인증·출생일)는 이 안에 있다. */
const DATE_YEAR_MIN = 1900;
const DATE_YEAR_MAX = 2100;
const DATE_SEPARATOR_SPLIT = /[\s.\-/]+/;

/**
 * 날짜 — `YYYY.MM.DD` 로 정돈한다.
 *
 * 구분 문자(점·하이픈·슬래시·공백)가 있으면 연·월·일 세 조각으로 읽어 한 자리 월·일(`2025.3.1`)도
 * 받는다. 구분 문자가 없으면 8자리(`20250131`)만 받는다 — `202531` 은 3월 1일인지 31일인지 모른다.
 * 끝의 점(`2025. 3. 1.` — 한국식 표기)은 빈 조각이라 버린다.
 */
function parseDate(raw: string): ParseResult {
  const value = raw.trim();
  if (/[^0-9\s.\-/]/.test(value)) return { ok: false, reason: 'not_a_number' };
  let parts: string[];
  if (/[\s.\-/]/.test(value)) {
    parts = value.split(DATE_SEPARATOR_SPLIT).filter((p) => p !== '');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    const [y, m, d] = parts as [string, string, string];
    if (y.length !== 4 || m.length > 2 || d.length > 2) return { ok: false, reason: 'malformed' };
  } else {
    if (value.length !== 8) return { ok: false, reason: 'wrong_length' };
    parts = [value.slice(0, 4), value.slice(4, 6), value.slice(6)];
  }
  const [year, month, day] = parts.map(Number) as [number, number, number];
  // 윤년은 Date 로 판정한다 — UTC 로 만들어 시간대가 날짜를 밀지 않게 한다
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (year < DATE_YEAR_MIN || year > DATE_YEAR_MAX || day < 1 || day > daysInMonth) {
    return { ok: false, reason: 'invalid_date' };
  }
  return {
    ok: true,
    normalized: `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`,
  };
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
  if (format === 'date') return parseDate(raw);
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    if (format === 'phone') return parseInternational(trimmed, parsePhone);
    if (format === 'mobile') return parseInternational(trimmed, parseMobile);
  }

  const digits = digitsOf(trimmed);
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

/** 형식 이름 — 빌더 선택지(한국어)와 응답 화면 문구가 같은 사전 글자를 쓴다. */
const FORMAT_LABEL_KEY: Record<InputFormat, SystemStringKey> = {
  mobile: 'format.label.mobile',
  phone: 'format.label.phone',
  biz_number: 'format.label.biz_number',
  corp_number: 'format.label.corp_number',
  email: 'format.label.email',
  date: 'format.label.date',
};

/** 「숫자로 입력해 주세요」 — 한국어 조사(은/는)가 형식 이름마다 달라 형식마다 문장을 둔다. */
const NOT_A_NUMBER_KEY: Record<InputFormat, SystemStringKey> = {
  mobile: 'format.notANumber.mobile',
  phone: 'format.notANumber.phone',
  biz_number: 'format.notANumber.biz_number',
  corp_number: 'format.notANumber.corp_number',
  email: 'format.notANumber.email',
  date: 'format.notANumber.date',
};

/** 자릿수가 정해진 형식 — 「N자리입니다」(조사 때문에 형식마다 문장). */
const WRONG_LENGTH_FIXED_KEY: Record<'biz_number' | 'corp_number', SystemStringKey> = {
  biz_number: 'format.wrongLengthFixed.biz_number',
  corp_number: 'format.wrongLengthFixed.corp_number',
};

/** 형식의 화면 이름. 빌더 선택지·응답자 안내 문구가 이 한 곳을 참조한다. */
export const INPUT_FORMAT_LABEL: Record<InputFormat, string> = {
  mobile: systemText(FORMAT_LABEL_KEY.mobile),
  phone: systemText(FORMAT_LABEL_KEY.phone),
  biz_number: systemText(FORMAT_LABEL_KEY.biz_number),
  corp_number: systemText(FORMAT_LABEL_KEY.corp_number),
  email: systemText(FORMAT_LABEL_KEY.email),
  date: systemText(FORMAT_LABEL_KEY.date),
};

/**
 * 입력칸 placeholder 로 쓰는 예시 값. 운영자가 placeholder 를 적지 않았을 때만 쓴다.
 * 사업자·법인번호 예시는 **체크섬이 맞는 값**이어야 한다 — 통과하지 못하는 번호를
 * 예시로 보여주면 그대로 따라 친 응답자가 막힌다(테스트가 이 조건을 지킨다).
 */
const INPUT_FORMAT_SAMPLE: Record<InputFormat, string> = {
  mobile: '010-1234-5678',
  phone: '02-123-4567',
  biz_number: '123-45-67891',
  corp_number: '110111-1234569',
  email: 'name@example.com',
  date: '2025.01.31',
};

export function formatSampleValue(format: InputFormat): string {
  return INPUT_FORMAT_SAMPLE[format];
}

/** 자릿수를 말할 수 있는 형식만 — 전화번호는 지역번호·국번에 따라 갈려 자릿수 하나로 못 말한다. */
const FIXED_LENGTH: Record<'biz_number' | 'corp_number', number> = {
  biz_number: 10,
  corp_number: 13,
};

/**
 * 형식별·실패 사유별 기본 안내 문구.
 *
 * 문항별 커스터마이즈를 두지 않는다 — 실패 사유가 다섯인데 문구가 하나면 안내가
 * 뭉뚱그려지고, 운영자에게 사유마다 문구를 받게 하면 설정이 다섯 배가 된다.
 * 문구는 현재 언어(기본 한국어)를 따른다 — 시스템 글자 사전(`utils/system-strings`).
 */
export function formatFailureMessage(
  format: InputFormat,
  reason: FormatFailure,
  locale: SurveyLocale = DEFAULT_SURVEY_LOCALE,
): string {
  const values = { label: systemText(FORMAT_LABEL_KEY[format], locale) };
  // 날짜는 자릿수·구조 실패를 한 문장(예시 값 포함)으로 안내한다 — 응답자에게는 같은 고칠 방향이다
  if (format === 'date' && (reason === 'wrong_length' || reason === 'malformed')) {
    return systemText('format.dateShape', locale);
  }
  switch (reason) {
    case 'not_a_number':
      return systemText(NOT_A_NUMBER_KEY[format], locale);
    case 'wrong_length': {
      if (format === 'biz_number' || format === 'corp_number') {
        return systemText(WRONG_LENGTH_FIXED_KEY[format], locale, { length: FIXED_LENGTH[format] });
      }
      return systemText('format.wrongLength', locale, values);
    }
    case 'unknown_prefix':
      return format === 'mobile'
        ? systemText('format.unknownPrefixMobile', locale)
        : systemText('format.unknownPrefix', locale);
    case 'checksum_mismatch':
      return systemText('format.checksum', locale, values);
    case 'malformed':
      return systemText('format.malformed', locale, values);
    case 'non_ascii':
      // 이메일만 나는 사유다(`parseEmail`)
      return systemText('format.nonAscii', locale);
    case 'invalid_date':
      // 날짜만 나는 사유다(`parseDate`)
      return systemText('format.invalidDate', locale);
  }
}

/**
 * 형식 칸 타이핑 필터 — 번호 형식은 숫자와 하이픈만 통과시킨다(글자·공백·괄호·점은 떨어뜨린다).
 * 날짜는 숫자와 구분 문자(점·하이픈·슬래시)를 남긴다 — 정돈(`YYYY.MM.DD`)은 blur 때 한 번이다.
 * 검사(`parseInputFormat`)는 공백·괄호·점도 구분 문자로 받아 주지만, 타이핑 단계에서는
 * "숫자만 받는 칸"으로 보이는 것이 목적이라 하이픈 하나만 남긴다. 붙여넣기도 같은 필터를
 * 타므로 `(02) 123-4567` 을 붙이면 `02123-4567` 이 되고 blur 정돈이 `02-123-4567` 로 맞춘다.
 * 전화·휴대전화는 맨 앞의 `+` 하나도 남긴다 — 해외 번호(`parseInternational`). 중간의 `+` 는 떨어뜨린다.
 * 이메일은 글자가 본문이라 손대지 않는다.
 */
export function filterFormatTyping(format: InputFormat, raw: string): string {
  if (format === 'email') return raw;
  if (format === 'date') return raw.replace(/[^0-9.\-/]/g, '');
  if (format === 'phone' || format === 'mobile') {
    const kept = raw.replace(/[^0-9+-]/g, '');
    return (kept.startsWith('+') ? '+' : '') + kept.replace(/\+/g, '');
  }
  return raw.replace(/[^0-9-]/g, '');
}
