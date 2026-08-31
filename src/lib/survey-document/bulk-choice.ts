import type { Question, QuestionOption } from '@/types/survey';

/**
 * 블록 일괄 선택 — "이 블록 전부 필요함"을 한 번에 고르게 한다.
 *
 * 조건이 까다로운 이유는 하나다. 선택지가 조금이라도 다른 문항이 섞이면 일괄
 * 버튼이 어떤 문항에는 없는 값을 쓰게 되고, 그건 응답자에게 보이지 않는
 * 오답이 된다. 그래서 **선택지 값 목록이 완전히 같은 단일선택 문항 둘 이상**
 * 일 때만 낸다.
 *
 * 기타입력이 켜진 선택지(의견)는 일괄 대상에서 뺀다 — 서술이 비면 답으로 치지
 * 않으므로 일괄로 고르면 전부 미응답이 된다.
 */
export interface BulkChoice {
  value: string;
  label: string;
}

function optionSignature(options: readonly QuestionOption[]): string {
  return options.map((o) => o.value).join(' ');
}

/** 이 문항들에 낼 수 있는 일괄 선택지. 낼 수 없으면 빈 배열. */
export function resolveBulkChoices(questions: readonly Question[]): BulkChoice[] {
  if (questions.length < 2) return [];

  const first = questions[0];
  if (!first || first.type !== 'radio') return [];
  const options = first.options ?? [];
  if (options.length === 0) return [];

  const signature = optionSignature(options);
  for (const question of questions) {
    if (question.type !== 'radio') return [];
    const own = question.options ?? [];
    if (own.length === 0 || optionSignature(own) !== signature) return [];
  }

  return options
    .filter((option) => !option.allowTextInput)
    .map((option) => ({ value: option.value, label: option.label }));
}
