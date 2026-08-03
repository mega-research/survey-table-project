import type { Question, QuestionOption, RankingAnswer, TableCell } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { resolveRankingOptions } from '@/utils/ranking-source';

/**
 * 응답 인용 수집기.
 *
 * 앞 질문의 응답에서 `{ 인용이름: 조립된문구 }` 를 계산한다. 결과는 저장되지 않는 파생값이며,
 * 응답 페이지와 빌더 테스트 모드가 같은 함수를 부른다 (계산이 갈리면 "빌더에서 본 문구와
 * 실제 응답 문구가 다름"이 발생하므로 반드시 이 모듈 하나만 사용할 것).
 *
 * 표시 여부(displayCondition)는 보지 않는다. 보면
 * quotes → visibleQuestions → evalCtx → quotes 순환이 생긴다.
 * 대가로 "답한 뒤 조건이 뒤집혀 숨겨진 질문"의 문구가 계속 인용되며, 이는 운영자가
 * 소비처 질문에 같은 표시 조건을 걸어 회피한다.
 */

/** 앞 문구의 받침으로 와/과를 판정한다. 한글 음절이 아니면 받침 없음으로 취급. */
function josaWaGwa(prev: string): '와' | '과' {
  const last = prev.trim().at(-1);
  if (!last) return '와';
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return '와';
  return (code - 0xac00) % 28 === 0 ? '와' : '과';
}

/**
 * 수집된 문구들을 개수별 규칙으로 조립한다.
 * 1개 "A" / 2개 "A와 B" / 3개+ "A, B, C" / 0개 ""
 *
 * 을·를 같은 조사는 코드가 건드리지 않는다 (운영자가 제목 편집에서 처리).
 * 다만 항목 연결의 와/과는 조립 과정에서 생기는 문자라 코드가 만든다.
 */
export function joinQuoteParts(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  if (parts.length === 2) {
    const [a, b] = parts as [string, string];
    return `${a}${josaWaGwa(a)} ${b}`;
  }
  return parts.join(', ');
}

/** 응답값을 문자열 집합으로 평탄화한다. 옵션 선택 여부 판정에만 쓴다. */
function toValueSet(raw: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v) out.add(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === 'object') {
      for (const item of Object.values(v as Record<string, unknown>)) walk(item);
    }
  };
  walk(raw);
  return out;
}

/**
 * 후보 하나를 최종 문구로 렌더한다. 기여하지 않으면 null.
 *
 * - `mode: 'option'` — 선택되면 수집. 문구가 비면 수집 제외.
 * - `mode: 'input'`  — 값이 있으면 수집. 문구가 비면 입력값을 그대로 사용.
 */
export function renderQuoteCandidate(
  quoteText: string | undefined,
  mode: 'option' | 'input',
  inputValue: string,
): string | null {
  const template = (quoteText ?? '').trim();
  if (!template) return mode === 'option' ? null : inputValue;
  const rendered = template.replaceAll('{{입력}}', inputValue);
  // 문구가 비어있지 않아도 렌더 결과가 빌 수 있다 — 문구가 `{{입력}}` 뿐인데
  // 응답자가 아무것도 안 친 경우. 빈 기여를 목록에 넣으면 조립에서 조사·쉼표만
  // 남아 "와 BBB" / "A, , C" 같은 깨진 문장이 된다. 빈 문구와 동일하게 제외한다.
  if (!rendered) return null;
  return rendered;
}

/** 옵션 경로 — 선택된 옵션에서 후보를 뽑는다. */
function collectFromOptions(
  options: QuestionOption[],
  selected: Set<string>,
  optTexts: Record<string, string>,
): string[] {
  const parts: string[] = [];
  for (const opt of options) {
    if (!selected.has(opt.value)) continue;
    const rendered = renderQuoteCandidate(
      opt.answerQuoteText,
      'option',
      optTexts[opt.id] ?? '',
    );
    if (rendered !== null) parts.push(rendered);
  }
  return parts;
}

/** 순위형 — 정의 순서가 아니라 순위 순으로 나열한다. 순서 자체가 답이므로 예외를 둔다. */
function collectFromRanking(
  q: Question,
  raw: unknown,
  optTexts: Record<string, string>,
): string[] {
  if (!Array.isArray(raw)) return [];
  const answers = (raw as RankingAnswer[])
    .filter((a) => a && typeof a.optionValue === 'string' && a.optionValue)
    .slice()
    .sort((a, b) => a.rank - b.rank);

  // 옵션 소스(manual/table) 판정과 셀→옵션 변환은 resolveRankingOptions 가 흡수한다
  // (ranking-source.ts — table 소스는 자신의 tableRowsData 내 ranking_opt 셀).
  const source: QuestionOption[] = resolveRankingOptions(q);

  const parts: string[] = [];
  for (const answer of answers) {
    const opt = source.find((o) => o.value === answer.optionValue);
    if (!opt) continue;
    const inputValue = answer.optionText ?? optTexts[opt.id] ?? '';
    const rendered = renderQuoteCandidate(opt.answerQuoteText, 'option', inputValue);
    if (rendered !== null) parts.push(rendered);
  }
  return parts;
}

/** 그 자체가 질문 노릇을 하는 셀 타입. choice_opt/ranking_opt 는 옵션이라 제외. */
const QUESTION_LIKE_CELL_TYPES = new Set(['radio', 'checkbox', 'select', 'input', 'ranking']);

/** 셀 하나에서 기여 후보를 뽑는다. 셀 단위 이름으로 묶기 위해 셀별로 분리했다. */
function collectFromSingleCell(
  cell: TableCell,
  value: unknown,
  optTexts: Record<string, string>,
): string[] {
  if (cell.type === 'input') {
    const text = typeof value === 'string' ? value : '';
    if (!text) return []; // 빈 값만 제외. 숫자 0 은 값이다
    const rendered = renderQuoteCandidate(cell.answerQuoteText, 'input', text);
    return rendered === null ? [] : [rendered];
  }
  if (cell.type === 'radio' || cell.type === 'checkbox' || cell.type === 'select') {
    return collectFromOptions(cellOptionsOf(cell), toValueSet(value), optTexts);
  }
  if (cell.type === 'ranking') {
    return collectFromCellRanking(cell, value, optTexts);
  }
  return [];
}

/** radio/checkbox/select 셀의 옵션 리스트를 QuestionOption 형태로 통일해 반환. */
function cellOptionsOf(cell: TableCell): QuestionOption[] {
  const raw =
    cell.type === 'radio'
      ? cell.radioOptions
      : cell.type === 'checkbox'
        ? cell.checkboxOptions
        : cell.selectOptions;
  return (raw ?? []) as unknown as QuestionOption[];
}

/** 셀 내부 순위형 — 순위 순으로 나열. */
function collectFromCellRanking(
  cell: TableCell,
  raw: unknown,
  optTexts: Record<string, string>,
): string[] {
  if (!Array.isArray(raw)) return [];
  // rankingOptions 는 이미 QuestionOption[] 이다 (types/survey.ts:340) — 캐스팅 불필요.
  const source = cell.rankingOptions ?? [];
  const answers = (raw as RankingAnswer[])
    .filter((a) => a && typeof a.optionValue === 'string' && a.optionValue)
    .slice()
    .sort((a, b) => a.rank - b.rank);

  const parts: string[] = [];
  for (const answer of answers) {
    const opt = source.find((o) => o.value === answer.optionValue);
    if (!opt) continue;
    const inputValue = answer.optionText ?? optTexts[opt.id] ?? '';
    const rendered = renderQuoteCandidate(opt.answerQuoteText, 'option', inputValue);
    if (rendered !== null) parts.push(rendered);
  }
  return parts;
}

/** 이름별 목록에 후보를 쌓는다. 빈 배열이어도 키는 만든다 (미응답 시 빈 문자열을 내야
 * 빌더의 `[오타이름]` 진단이 성립하므로, 이 함수를 거치는 이름은 항상 결과에 나타난다). */
function pushParts(byName: Map<string, string[]>, name: string, parts: string[]): void {
  if (!byName.has(name)) byName.set(name, []);
  byName.get(name)?.push(...parts);
}

export function collectAnswerQuotes(
  questions: Question[],
  responses: Record<string, unknown>,
  optionTextsByQuestion: Record<string, Record<string, string>>,
): Record<string, string> {
  // 이름별 목록에 쌓고 마지막에 한 번 조립한다. 여러 질문/셀이 같은 이름을 쓰면 합쳐진다.
  const byName = new Map<string, string[]>();

  const ordered = [...questions].sort((a, b) => a.order - b.order);

  for (const q of ordered) {
    const raw = responses[q.id];
    const optTexts = optionTextsByQuestion[q.id] ?? {};

    // 질문 레벨 경로 — 표 질문은 제외한다. 표는 셀이 각자 이름을 갖는다.
    if (q.type !== 'table' && q.answerQuoteEnabled) {
      const name = (q.answerQuoteName ?? '').trim();
      if (name) {
        const selected = toValueSet(raw);
        const parts: string[] = [];
        // radio/checkbox 는 resolveChoiceOptions 단일 진입점만 탄다
        // (manual/table 소스 구분을 이 함수가 흡수하므로, 표 셀 순회와 이중 계산되지 않는다).
        if (q.type === 'radio' || q.type === 'checkbox') {
          parts.push(...collectFromOptions(resolveChoiceOptions(q), selected, optTexts));
        } else if (q.type === 'select') {
          parts.push(...collectFromOptions(q.options ?? [], selected, optTexts));
        } else if (q.type === 'multiselect') {
          for (const level of q.selectLevels ?? []) {
            parts.push(...collectFromOptions(level.options ?? [], selected, optTexts));
          }
        } else if (q.type === 'ranking') {
          parts.push(...collectFromRanking(q, raw, optTexts));
        } else if (q.type === 'text') {
          // 단답형은 질문 자체가 입력 단위 후보 하나. 장문형(textarea)은 인용 대상이 아니다.
          const text = typeof raw === 'string' ? raw : '';
          if (text) {
            const rendered = renderQuoteCandidate(q.answerQuoteText, 'input', text);
            if (rendered !== null) parts.push(rendered);
          }
        }
        pushParts(byName, name, parts);
      }
    }

    // 셀 레벨 경로 — 질문 노릇을 하는 셀마다 자기 이름으로 묶는다.
    // choice_opt/ranking_opt 는 질문 레벨 옵션이므로 여기서 다루지 않는다
    // (표-소스 radio/checkbox/ranking 질문의 질문 레벨 경로가 이미 담당).
    const cellValues = (raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw
      : {}) as Record<string, unknown>;
    for (const row of q.tableRowsData ?? []) {
      for (const cell of row.cells) {
        if (cell.isHidden) continue;
        if (!QUESTION_LIKE_CELL_TYPES.has(cell.type)) continue;
        if (!cell.answerQuoteEnabled) continue;
        const cellName = (cell.answerQuoteName ?? '').trim();
        if (!cellName) continue;
        pushParts(byName, cellName, collectFromSingleCell(cell, cellValues[cell.id], optTexts));
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [name, parts] of byName) out[name] = joinQuoteParts(parts);
  return out;
}
