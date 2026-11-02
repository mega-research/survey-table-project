/**
 * DB 쿼리 바인딩 값 스트립 규칙 — pino err 직렬화(`err-serializer`)와 Sentry beforeSend
 * (`sentry-before-send`)가 이 한 정의를 공유한다. 사본을 두면 한쪽만 고쳐져 유출이 갈린다.
 *
 * drizzle-orm 은 모든 쿼리 실패를 DrizzleQueryError 로 감싸는데,
 * 1) message 가 `Failed query: ${query}\nparams: ${params}` 라 바인딩 값(응답 JSONB·명단 값·
 *    검색어)이 문자열에 보간되고 — redact 로는 못 막는다,
 * 2) query/params 가 enumerable own property 라 직렬화기가 그대로 복사하며,
 * 3) stack 첫 줄에도 message 가 들어간다.
 *
 * 지우는 것: `\nparams: …` 보간 구간, query·params·parameters 키의 값.
 * 남기는 것: SQL 문장(`$1` 자리표시 — 값이 아니다), 바인딩 개수, 뒤따르는 스택 프레임·원인 메시지.
 *
 * 원본 에러를 알면 보간된 문자열을 정확히 알 수 있어(`String(params)`) 그 구간만 갈아끼운다.
 * 모르는 보간 구간이 남으면 문자열 끝까지 지운다 — 값이 어디서 끝나는지 알 수 없어서다.
 */

export const STRIPPED = '[Stripped]';

const STRIP_KEYS: ReadonlySet<string> = new Set(['query', 'params', 'parameters']);

const PARAMS_MARKER = '\nparams:';

/** 아직 지우지 않은 보간 구간 — 이미 갈아끼운 `params: [Stripped…]` 는 건너뛴다. */
const UNKNOWN_INTERPOLATION = /\nparams:(?! \[Stripped)[\s\S]*$/;

const MAX_DEPTH = 8;

/** 원본 에러에서 알아낸 보간 구간 하나 — 정확한 문자열과 바인딩 개수. */
interface KnownInterpolation {
  needle: string;
  count: number;
}

function strippedLabel(count: number): string {
  if (count <= 0) return STRIPPED;
  return `[Stripped ${count} ${count === 1 ? 'value' : 'values'}]`;
}

/** SQL 의 `$n` 자리표시 중 가장 큰 번호 = 바인딩 개수 (drizzle pg 방언은 1부터 차례로 단다). */
function countPlaceholders(sql: string): number {
  let max = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** cause 체인을 따라 DrizzleQueryError 모양(message 에 params 보간)을 찾아 보간 문자열을 뽑는다. */
function collectKnownInterpolations(source: unknown): KnownInterpolation[] {
  const found: KnownInterpolation[] = [];
  let cur: unknown = source;
  for (let depth = 0; depth < 5 && cur !== null && typeof cur === 'object'; depth++) {
    const { message, params } = cur as { message?: unknown; params?: unknown };
    if (typeof message === 'string' && params !== undefined) {
      const needle = `${PARAMS_MARKER} ${String(params)}`;
      if (message.includes(needle)) {
        found.push({ needle, count: Array.isArray(params) ? params.length : 0 });
      }
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  // 긴 것부터 — 한 보간이 다른 보간을 품는 경우 짧은 쪽이 먼저 잘라 먹지 않도록.
  return found.sort((a, b) => b.needle.length - a.needle.length);
}

function stripWith(text: string, known: readonly KnownInterpolation[]): string {
  if (!text.includes(PARAMS_MARKER)) return text;
  let out = text;
  for (const { needle, count } of known) {
    out = out.split(needle).join(`${PARAMS_MARKER} ${strippedLabel(count)}`);
  }
  return out.replace(
    UNKNOWN_INTERPOLATION,
    (_match, offset: number) => `${PARAMS_MARKER} ${strippedLabel(countPlaceholders(out.slice(0, offset)))}`,
  );
}

/**
 * 문자열의 params 보간 구간을 지우고 바인딩 개수만 남긴다. 없으면 그대로.
 * `source` 로 원본 에러를 주면 보간 구간만 정확히 갈아끼우고, 아니면 끝까지 지운다.
 */
export function stripParamsInterpolation(text: string, source?: unknown): string {
  return stripWith(text, collectKnownInterpolations(source));
}

function walk(node: unknown, depth: number, seen: WeakSet<object>, known: readonly KnownInterpolation[]): void {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (STRIP_KEYS.has(key)) {
      record[key] = STRIPPED;
    } else if (typeof value === 'string') {
      record[key] = stripWith(value, known);
    } else {
      walk(value, depth + 1, seen, known);
    }
  }
}

/**
 * 객체 트리를 제자리에서 훑어 바인딩 값을 지운다 (cause 체인·배열 포함, 순환 안전).
 * `source` 는 그 트리를 만든 원본 에러 — 주면 스택 프레임·원인 메시지를 살린다.
 */
export function scrubQueryParams(node: unknown, source?: unknown): void {
  walk(node, 0, new WeakSet(), collectKnownInterpolations(source));
}
