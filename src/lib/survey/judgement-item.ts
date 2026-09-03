import type { Question } from '@/types/survey';

/**
 * 판단 항목 — 문항 수요조사의 "필요함 / 필요하지 않음" 한 줄.
 *
 * **전용 질문 유형이 아니다.** 평범한 단일선택이고, 선택지가 정확히 둘이며 그중
 * 하나가 부정 라벨인 **모양**으로 알아본다. 그래서 이 판정이 응답 화면·집계 양쪽의
 * 공용 어휘가 된다.
 *
 * 의견은 판정값이 아니다. 판단 항목 바로 뒤에 오는 **짝 문항**(장문형, 코드 규약
 * `부모_T`)이 받는다 — [[resolveOpinionPairs]]. 처음엔 의견이 세 번째 선택지였는데,
 * 그러면 "필요함을 고른 채로 의견도 적기"가 구조적으로 안 된다 (ADR 0022).
 */
export interface JudgementShape {
  needValue: string;
  dropValue: string;
}

/** 의견 짝 문항의 코드 접미사. 부모 문항코드 + 이것이 짝의 코드다. */
export const OPINION_CODE_SUFFIX = '_T';

/**
 * 부정 선택지의 라벨 표지. "필요하지 않음"·"불필요"·"필요없음" 계열을 잡는다.
 *
 * 선택지 **순서**로 필요/불필요를 정하지 않는 이유는 하나다 — 기획자가 부정을
 * 먼저 배치하면 필요율이 조용히 뒤집힌다. 집계는 그 값을 근거로 문항을 빼는 자리다.
 */
const NEGATIVE_LABEL_PATTERNS = [/필요\s*하지\s*않/, /불필요/, /필요\s*없/];

function isNegativeLabel(label: string): boolean {
  return NEGATIVE_LABEL_PATTERNS.some((pattern) => pattern.test(label));
}

/**
 * 판단 항목의 모양을 푼다. 어느 쪽이 '필요함'인지 **가릴 수 없으면 null** 이다 —
 * 그 문항은 판단 항목으로 취급하지 않는다. 추측해서 값을 내는 것보다 빈 칸이 낫다.
 *
 * 옛 3지선다(의견 선택지 포함)는 받지 않는다. 계속 받아 주면 이전이 덜 된 설문이
 * 조용히 옛 규칙(의견이 분모에 들어감)으로 집계된다.
 */
export function resolveJudgementShape(question: Question): JudgementShape | null {
  if (question.type !== 'radio') return null;
  const options = question.options ?? [];
  if (options.length !== 2) return null;
  // 기타입력이 붙은 선택지는 "고르면 서술 필수"라 판정값일 수 없다.
  if (options.some((o) => o.allowTextInput)) return null;

  const negatives = options.filter((o) => isNegativeLabel(o.label));
  // 정확히 하나가 부정으로 읽혀야 한다. 둘 다이거나 하나도 아니면 가릴 수 없다.
  if (negatives.length !== 1) return null;
  const drop = negatives[0];
  const need = options.find((o) => o !== drop);
  if (!drop || !need) return null;

  return { needValue: need.value, dropValue: drop.value };
}

/**
 * 판단 항목과 그 의견 짝 문항의 대응.
 *
 * 짝은 **두 조건이 모두** 맞을 때만이다 — 코드가 `부모코드_T` 이고, 부모 바로 다음
 * 순서이고, 장문형이다. 코드만 보면 관리자가 순서를 옮겼을 때 다른 행에 붙어 그려지고,
 * 순서만 보면 우연히 뒤에 온 서술 문항을 의견으로 오인한다. 어긋나면 짝이 없는 것으로
 * 보고 그 `_T` 는 일반 문항으로 남는다 — 조용히 잘못 붙이지 않는다.
 */
export interface OpinionPairs {
  /** 판단 항목 id → 의견 짝 문항. */
  opinionOf: ReadonlyMap<string, Question>;
  /** 짝으로 인정된 의견 문항 id 전부. 목록에서 자기 행을 지우는 데 쓴다. */
  opinionIds: ReadonlySet<string>;
}

export function resolveOpinionPairs(questionsInOrder: readonly Question[]): OpinionPairs {
  const opinionOf = new Map<string, Question>();
  const opinionIds = new Set<string>();
  for (let index = 0; index + 1 < questionsInOrder.length; index += 1) {
    const parent = questionsInOrder[index];
    const next = questionsInOrder[index + 1];
    if (!parent || !next) continue;
    if (!resolveJudgementShape(parent)) continue;
    const parentCode = parent.questionCode?.trim();
    // 빈 코드 + _T === '_T' 인 문항이 우연히 뒤에 오면 짝이 되어 버린다.
    if (!parentCode) continue;
    if (next.type !== 'textarea') continue;
    if (next.questionCode !== `${parentCode}${OPINION_CODE_SUFFIX}`) continue;
    opinionOf.set(parent.id, next);
    opinionIds.add(next.id);
  }
  return { opinionOf, opinionIds };
}

/** 의견 답이 비어 있지 않은가. 공백만 있는 것은 비어 있는 것이다. */
export function hasOpinionText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 블록 일괄 선택지 — "이 블록 전부 필요함".
 *
 * 값을 하나 골라 전부에 쓰지 **않는다.** 선택지 값은 문항마다 따로 발번되므로
 * 옆 문항의 값을 쓰면 그 문항에는 없는 값이 들어가고, 그건 응답자에게 보이지 않는
 * 오답이 된다. 그래서 문항별로 **자기 값**을 담아 돌려준다.
 *
 * 라벨은 첫 문항 것을 쓴다(같은 블록의 판단 항목은 같은 어휘를 쓴다는 전제).
 * 의견 짝 문항은 판단 항목이 아니라 저절로 빠진다.
 */
export interface JudgementBulkChoice {
  key: 'need' | 'drop';
  label: string;
  /** 문항 id → 그 문항에서 이 선택지에 해당하는 값. */
  valueByQuestionId: Record<string, string>;
}

export function resolveJudgementBulkChoices(
  questions: readonly Question[],
): JudgementBulkChoice[] {
  const shaped = questions
    .map((question) => ({ question, shape: resolveJudgementShape(question) }))
    .filter((x): x is { question: Question; shape: JudgementShape } => x.shape !== null);
  // 하나뿐이면 일괄이 될 일이 없다.
  if (shaped.length < 2) return [];

  const first = shaped[0];
  if (!first) return [];
  const labelOf = (question: Question, value: string) =>
    question.options?.find((o) => o.value === value)?.label ?? value;

  return [
    {
      key: 'need' as const,
      label: labelOf(first.question, first.shape.needValue),
      valueByQuestionId: Object.fromEntries(
        shaped.map(({ question, shape }) => [question.id, shape.needValue]),
      ),
    },
    {
      key: 'drop' as const,
      label: labelOf(first.question, first.shape.dropValue),
      valueByQuestionId: Object.fromEntries(
        shaped.map(({ question, shape }) => [question.id, shape.dropValue]),
      ),
    },
  ];
}
