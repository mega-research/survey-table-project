import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { Question, QuestionOption } from '@/types/survey';
import { isChoiceTableSource } from '@/utils/choice-source';

/** 토큰 치환에 쓰는 명단 값 — 값이 빈 키를 undefined 로 들고 있을 수 있다(token-prefill 과 같은 모양) */
type PrefillAttrs = Record<string, string | undefined> | null | undefined;

type ChoicePrefillQuestion = Pick<
  Question,
  'type' | 'options' | 'tableRowsData' | 'defaultValueTemplate'
>;

// 보기 문구 앞의 번호 표식 — 「① 예술분야 …」「1) …」「(1) …」「1. …」. 숫자 뒤 공백만으로는 떼지
// 않는다(「2026년 …」 같은 문구를 깎지 않게).
const LEADING_MARKER = /^\s*(?:[①-⑳]|\(\d{1,2}\)|\d{1,2}[).])\s*/;

function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** 한 단계에서 딱 하나만 맞으면 그 보기, 여럿이면 판정 불가(undefined 가 아니라 null), 없으면 다음 단계. */
function pickUnique(
  options: QuestionOption[],
  test: (option: QuestionOption) => boolean,
): QuestionOption | null | undefined {
  const hits = options.filter(test);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return null;
  return undefined;
}

/**
 * 명단 값 하나를 보기 하나에 맞춘다. 앞 단계일수록 엄격하다.
 *   1. 보기 값(`value`) 과 같다
 *   2. SPSS 코드(`spssNumericCode`) 와 같다
 *   3. 보기 문구(번호 표식을 뗀 것 포함)나 인용 문구와 같다
 *   4. 보기 문구·인용 문구에 그 값이 들어 있는 보기가 **하나뿐**이다 (「초기창업」 → 「① 예술분야 초기창업 지원사업」)
 * 어느 단계에서든 둘 이상 맞으면 고르지 않는다 — 틀린 보기를 잠그는 것보다 응답자가 고르게 두는 편이 낫다.
 */
export function matchPrefillOption(
  options: QuestionOption[],
  rawValue: string,
): QuestionOption | null {
  const v = normalize(rawValue);
  if (!v) return null;
  const labelsOf = (o: QuestionOption) =>
    [
      normalize(o.label),
      normalize(o.label.replace(LEADING_MARKER, '')),
      normalize(o.answerQuoteText),
    ].filter((s) => s.length > 0);
  const tiers: Array<(o: QuestionOption) => boolean> = [
    (o) => normalize(o.value) === v,
    (o) => o.spssNumericCode !== undefined && String(o.spssNumericCode) === v,
    (o) => labelsOf(o).some((s) => s === v),
    (o) => labelsOf(o).some((s) => s.includes(v)),
  ];
  for (const test of tiers) {
    const picked = pickUnique(options, test);
    if (picked !== undefined) return picked;
  }
  return null;
}

/**
 * 단일선택 문항의 명단 값 프리필 — 잠글 보기의 값(`option.value`). 템플릿이 없거나, 명단 값이 비거나,
 * 맞는 보기를 하나로 정하지 못하면 null 이고 그 문항은 평범한 단일선택이다(단답형 `resolveTokenPrefill`
 * 과 같은 「값이 왔을 때만 잠근다」 원칙).
 *
 * 응답 화면(잠금·자동 선택)과 서버 완료 검사(조작 복원 `restorePrefillAnswers`)가 같은 판정을 써야
 * 해서 공용 구역에 둔다. 보기를 표로 그리는 문항(choice_opt 셀)은 대상이 아니다.
 */
export function resolveChoicePrefill(
  question: ChoicePrefillQuestion,
  attrs: PrefillAttrs,
): string | null {
  if (question.type !== 'radio') return null;
  const template = question.defaultValueTemplate;
  if (!template || template.trim().length === 0) return null;
  if (isChoiceTableSource(question as Question)) return null;
  const value = substituteTokens(template, (attrs ?? {}) as Record<string, string>);
  return matchPrefillOption(question.options ?? [], value)?.value ?? null;
}
