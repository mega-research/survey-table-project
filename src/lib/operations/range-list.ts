export const INT32_MAX = 2147483647;

/**
 * 토큰 수 기본 상한 — 전체 검색이 범위 목록을 표시 컬럼마다 복제하므로
 * (토큰 수 × 컬럼 수) SQL 술어 폭증을 여기서 차단한다. 초과는 null(문법 불일치와 동일).
 */
export const MAX_ID_LIST_TOKENS = 200;

/**
 * 단일 컬럼(시스템ID·attrs) 인라인 상한 — 목록이 URL(q)에 실리므로 요청 헤더 한계
 * (Node 기본 16KB)를 넘지 않는 선. 4자리 ID + 구분자 ≈ 5바이트 × 2,000 = 10KB.
 * 초과분은 위젯이 서버에 저장하고 URL 에는 `list:<uuid>` 토큰만 싣는다.
 */
export const SINGLE_COLUMN_ID_LIST_MAX = 2000;

/**
 * 저장된 ID 목록 상한 — 필터 SQL 의 IN 바인드 파라미터가 Postgres 한계(65,535) 아래에
 * 머무는 선. 저장 목록 절 3개를 AND 로 걸어도 60,000 < 65,535. 위젯(전개 상한)·domain zod·
 * service 가 공유.
 */
export const MAX_STORED_ID_LIST = 20_000;

/**
 * 선행 0 토큰("010", "1-05") 존재 여부 — attrs 숫자 매칭에서 제외할 입력.
 * "010" 을 10 으로 접으면 원 행이 사라지므로 서버는 이런 입력을 텍스트 검색으로 보낸다.
 * 위젯은 같은 판정으로 목록 검색이 안 됨을 미리 알린다 (조용한 0건 방지).
 */
export function hasLeadingZeroToken(input: string): boolean {
  return /(^|[\s,;-])0\d/.test(input);
}

export interface NumRange {
  from: number;
  to: number;
}

export interface IdListParseOptions {
  /** 중복 제거 후 토큰 수 상한. 기본 MAX_ID_LIST_TOKENS(200). */
  maxTokens?: number;
}

/** 위젯 배지·경고용 상세 결과. parseIdListInput 은 이 결과를 null/배열로 접은 것. */
export interface IdListParseResult {
  /** 중복 제거된 범위 목록 (입력 순서 보존) */
  ranges: NumRange[];
  /** 중복 제거 후 토큰 수 (= ranges.length) */
  count: number;
  /** 접힌 중복 토큰 수 */
  duplicates: number;
  /** 숫자/범위 문법이 아닌 토큰 (입력 순서, 중복 포함) */
  invalid: string[];
  /** count 가 maxTokens 를 넘음 */
  overLimit: boolean;
}

const TOKEN_SEPARATOR = /[\s,;]+/;
const SINGLE_TOKEN = /^\d+$/;
const RANGE_TOKEN = /^(\d+)-(\d+)$/;

/** 시스템ID/숫자 attrs 값의 유효 범위 — 파서·저장 정규화·domain zod 가 공유. */
export function isValidId(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= INT32_MAX;
}

/**
 * "1-30, 45" / 엑셀 열 복사("99\n292\n235") 같은 범위·리스트 입력을 토큰 단위로 해석.
 *
 * - 구분자: 공백·개행·탭·콤마·세미콜론 (연속·선행·후행 구분자 허용 — 엑셀 흔적 "549,")
 * - 범위 "1 - 30" 처럼 하이픈 주변 공백은 범위로 접는다 (구분자로 쪼개지 않음)
 * - 값은 양의 정수 (1 ≤ n ≤ INT32_MAX) — 0/음수/소수/초과/텍스트는 invalid 토큰
 * - 역방향 (50-10) 은 자동 swap (10-50)
 * - 같은 값·같은 범위는 하나로 접고 duplicates 로 센다
 */
export function parseIdListDetailed(
  input: string,
  options: IdListParseOptions = {},
): IdListParseResult {
  const maxTokens = options.maxTokens ?? MAX_ID_LIST_TOKENS;
  const normalized = input.replace(/(\d)\s*-\s*(\d)/g, '$1-$2');
  const tokens = normalized.split(TOKEN_SEPARATOR).filter((t) => t.length > 0);

  const ranges: NumRange[] = [];
  const seen = new Set<string>();
  const invalid: string[] = [];
  let duplicates = 0;

  for (const token of tokens) {
    let range: NumRange | null = null;
    if (SINGLE_TOKEN.test(token)) {
      const n = Number(token);
      if (isValidId(n)) range = { from: n, to: n };
    } else {
      const m = RANGE_TOKEN.exec(token);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (isValidId(a) && isValidId(b)) range = { from: Math.min(a, b), to: Math.max(a, b) };
      }
    }
    if (!range) {
      invalid.push(token);
      continue;
    }
    const key = `${range.from}-${range.to}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    ranges.push(range);
  }

  return {
    ranges,
    count: ranges.length,
    duplicates,
    invalid,
    overLimit: ranges.length > maxTokens,
  };
}

/**
 * 범위/리스트 입력 파싱. 문법 불일치(숫자 아닌 토큰 포함)·빈 입력·상한 초과는 null.
 * 상세 사유가 필요한 위젯은 parseIdListDetailed 를 쓴다.
 *
 * progress-filters.server.ts / profiles-filters.server.ts / contacts-filters.server.ts 가 공유.
 */
export function parseIdListInput(
  input: string,
  options: IdListParseOptions = {},
): NumRange[] | null {
  const result = parseIdListDetailed(input, options);
  if (result.count === 0 || result.invalid.length > 0 || result.overLimit) return null;
  return result.ranges;
}
