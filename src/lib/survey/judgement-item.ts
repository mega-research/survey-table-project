import type { Question } from '@/types/survey';

/**
 * 판단 항목 — 문항 수요조사의 "필요함 / 필요하지 않음 / 의견" 한 줄.
 *
 * **전용 질문 유형이 아니다.** 평범한 단일선택이고, 선택지가 정확히 셋이며 그중
 * 하나가 기타입력(의견)인 **모양**으로 알아본다. 그래서 이 판정이 응답 화면·집계
 * 양쪽의 공용 어휘가 된다.
 */
export interface JudgementShape {
  needValue: string;
  dropValue: string;
  opinionValue: string;
  opinionOptionId: string;
}

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
 */
export function resolveJudgementShape(question: Question): JudgementShape | null {
  if (question.type !== 'radio') return null;
  const options = question.options ?? [];
  if (options.length !== 3) return null;
  const opinion = options.find((o) => o.allowTextInput);
  if (!opinion || options.filter((o) => o.allowTextInput).length !== 1) return null;

  const rest = options.filter((o) => !o.allowTextInput);
  const negatives = rest.filter((o) => isNegativeLabel(o.label));
  // 정확히 하나가 부정으로 읽혀야 한다. 둘 다이거나 하나도 아니면 가릴 수 없다.
  if (negatives.length !== 1) return null;
  const drop = negatives[0];
  const need = rest.find((o) => o !== drop);
  if (!drop || !need) return null;

  return {
    needValue: need.value,
    dropValue: drop.value,
    opinionValue: opinion.value,
    opinionOptionId: opinion.id,
  };
}

/**
 * 블록 일괄 선택지 — "이 블록 전부 필요함".
 *
 * 값을 하나 골라 전부에 쓰지 **않는다.** 선택지 값은 문항마다 따로 발번되므로
 * 옆 문항의 값을 쓰면 그 문항에는 없는 값이 들어가고, 그건 응답자에게 보이지 않는
 * 오답이 된다. 그래서 문항별로 **자기 값**을 담아 돌려준다.
 *
 * 라벨은 첫 문항 것을 쓴다(같은 블록의 판단 항목은 같은 어휘를 쓴다는 전제).
 * 의견은 대상에서 뺀다 — 서술이 비면 답으로 치지 않으므로 일괄로 고르면 전부 미응답이 된다.
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
