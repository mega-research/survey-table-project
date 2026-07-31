import type { Question, QuestionOption } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';

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
  return template.replaceAll('{{입력}}', inputValue);
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

export function collectAnswerQuotes(
  questions: Question[],
  responses: Record<string, unknown>,
  optionTextsByQuestion: Record<string, Record<string, string>>,
): Record<string, string> {
  // 이름별 목록에 쌓고 마지막에 한 번 조립한다. 여러 질문이 같은 이름을 쓰면 합쳐진다.
  const byName = new Map<string, string[]>();

  const ordered = [...questions].sort((a, b) => a.order - b.order);

  for (const q of ordered) {
    if (!q.answerQuoteEnabled) continue;
    const name = (q.answerQuoteName ?? '').trim();
    if (!name) continue;

    const raw = responses[q.id];
    const optTexts = optionTextsByQuestion[q.id] ?? {};
    const selected = toValueSet(raw);
    const parts: string[] = [];

    // 경로 1 — 옵션. radio/checkbox 는 resolveChoiceOptions 단일 진입점만 탄다
    // (manual/table 소스 구분을 이 함수가 흡수하므로, 표 셀 순회와 이중 계산되지 않는다).
    if (q.type === 'radio' || q.type === 'checkbox') {
      parts.push(...collectFromOptions(resolveChoiceOptions(q), selected, optTexts));
    } else if (q.type === 'select') {
      parts.push(...collectFromOptions(q.options ?? [], selected, optTexts));
    }

    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)?.push(...parts);
  }

  const out: Record<string, string> = {};
  for (const [name, parts] of byName) out[name] = joinQuoteParts(parts);
  return out;
}
