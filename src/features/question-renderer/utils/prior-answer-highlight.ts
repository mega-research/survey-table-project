/**
 * 이월 표시(prior-answer highlight) 판정 — CONTEXT.md > 추적조사, ADR 0024 참조.
 *
 * 화면에 지금 그려지는 값이 이월 값과 같으면 그 값을 빨강으로 칠한다. 응답자에게
 * "이 칸은 지난 회차와 같다"를 알려 손대지 않고 지나치는 것을 줄이는 표시다.
 *
 * **출처가 아니라 동일성으로 판정한다.** 프리필로 깔린 값인지 응답자가 직접 친 값인지는
 * 보지 않는다 — 그 구분을 하려면 "손댔음"을 응답 저장 형태에 남겨야 하는데(세션 ref 는
 * 재진입에서 비어 버린다) 색 하나를 위해 저장 형태를 늘리지 않기로 했다(ADR 0024).
 * 그래서 작년과 같은 답을 일부러 고른 칸도 칠해진다 — 표시의 의미가 "아직 안 본 값"이
 * 아니라 "작년과 같은 값"이므로 그것은 오류가 아니라 사실이다.
 *
 * 2026-09-08 DQ7 사고("상태 기준 판정은 응답자의 입력과 싸운다")와는 다른 자리다.
 * 그 결론은 값을 **바꾸는** 판정에 대한 것이고, 여기는 읽기만 하므로 최악이 "색이 하나 더
 * 칠해진다" 이다.
 *
 * **판정 단위는 값 조각이다** — 문항 전체가 아니라 응답자가 손대는 최소 단위마다 따로 본다.
 * 표 셀 20개 중 하나만 고쳤다고 나머지 19개가 검게 변하면, 표가 주력인 이 플랫폼에서 가장
 * 필요한 곳에서 정확히 무용지물이 된다. 텍스트 조각은 이월 면제와 같은
 * `isUntouchedPriorValue` 를 쓴다 — 두 규칙이 같은 칸에 다른 답을 내면
 * "검사는 면제되는데 색은 없다"가 눈에 보이는 형태로 드러난다.
 *
 * **표시 전용이다.** 저장·검증·내보내기·제출 판정 어디에도 영향이 없다.
 */
import {
  isUntouchedPriorValue,
  priorAnswerText,
  priorOptionText,
  type PriorAnswers,
} from '@/lib/survey/prior-answers';
import { supportsChangeConfirmation } from '@/lib/survey/change-confirmation';
import { OPT_TEXTS_KEY } from '@/lib/survey/response-sidecars';
import type { Question, RankingAnswer } from '@/types/survey';

/**
 * 표시 자격을 통과한 이월 응답 묶음.
 *
 * 원본 이월 응답이 아니라 **프리필과 같은 술어로 걸러진** 값이다. 호출부가 원본을 넘기지
 * 않도록 이름을 구분한다 — 담당자가 「이월값 불러오기」를 끄거나 도달 불가능한 조건을 걸어
 * 감춘 값이 색으로 되살아나면 그 설정이 반쪽만 듣는 것이 된다.
 */
export type HighlightPriorAnswers = PriorAnswers | null;

/**
 * 이월 값 텍스트에 얹는 클래스 — 단답·장문·드롭다운 표시 텍스트·순위 텍스트·표 input 셀.
 *
 * 입력칸 **테두리**는 칠하지 않는다. 빨간 테두리는 이 앱에서도 웹 일반에서도 입력 오류의
 * 표준 표현이고, 이월 표시에는 안내 문구를 두지 않기로 했으므로(ADR 0024) 테두리를 칠하면
 * 응답자에게 "여기 잘못 썼다" 로만 읽힌다.
 */
export const PRIOR_HIGHLIGHT_TEXT_CLS = 'text-red-600';

/**
 * 이월 선택의 컨트롤(라디오 동그라미·체크 표시)에 **덧붙이는** 클래스.
 *
 * 컨트롤의 색은 원래 "선택됨"을 뜻하므로 채널이 하나로 유지된다 — 빨강도 파랑도 선택됨이고
 * 색조가 출처를 말한다. 라벨 텍스트는 칠하지 않는다: 선택하지 않은 보기의 라벨은 검정이라
 * 라벨을 칠하면 "빨강 = 선택됨"으로 학습된다.
 *
 * **`accent-*` 여야 한다.** 이 레포에는 `@tailwindcss/forms` 가 없어서 네이티브
 * radio/checkbox 에 붙은 `text-blue-600` 은 컨트롤 색을 바꾸지 않는다(글자색 유틸리티일
 * 뿐이고 컨트롤은 브라우저 기본 accent 로 그려진다). 선택되지 않은 상태에는 아무것도
 * 붙이지 않는다 — 기본 accent 가 곧 "원래 파란색" 이고, 그걸 고정하면 이 기능과 무관한
 * 모든 보기의 색이 함께 바뀐다.
 */
export const PRIOR_HIGHLIGHT_CONTROL_CLS = 'accent-red-500';

/**
 * 조건 필터를 통과한 이월 응답에서 **표시할 수 없는 문항**을 마저 걷어낸다.
 *
 * 남은 절반은 문항 유형 축이다(`supportsChangeConfirmation`) — 안내문은 답 자체가 없고,
 * 본문 프리필 템플릿이 걸린 문항은 이월 요약 채널이라 템플릿 값이 이기므로 이월 값과
 * 비교하는 것 자체가 무의미하다. 프리필·변동 확인이 쓰는 술어와 같은 것을 쓴다.
 *
 * `__optTexts__` 사이드카는 **문항의 top-level 이월 값이 살아남은 경우에만** 남긴다.
 * 조건 필터는 사이드카를 통째로 통과시키므로(문항 id 가 아니라 예약 키다) 유형 축만 걸면,
 * 담당자가 조건으로 막아 둔 문항의 상세기재 칸이 여전히 칠해진다 — 이월값 조건이 반쪽만
 * 듣는 셈이고 Q11 결정에 어긋난다. 답이 없는 문항의 상세기재는 떠 있을 자리도 없으므로
 * 함께 빠지는 것이 맞다.
 *
 * @param conditioned `filterPriorAnswersByCondition` 을 통과한 이월 응답
 */
export function selectHighlightablePriorAnswers(
  conditioned: PriorAnswers | null | undefined,
  questions: readonly Question[],
): HighlightPriorAnswers {
  if (!conditioned) return null;
  const excluded = new Set(
    questions.filter((question) => !supportsChangeConfirmation(question)).map((q) => q.id),
  );
  const out: PriorAnswers = {};
  for (const [key, value] of Object.entries(conditioned)) {
    if (excluded.has(key)) continue;
    if (key === OPT_TEXTS_KEY && value && typeof value === 'object' && !Array.isArray(value)) {
      const kept = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          ([qid]) =>
            !excluded.has(qid) &&
            Object.prototype.hasOwnProperty.call(conditioned, qid),
        ),
      );
      if (Object.keys(kept).length > 0) out[key] = kept;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** 이월 값에서 이 문항(또는 표 셀)의 조각을 꺼낸다. 없으면 undefined. */
function priorFragment(
  prior: HighlightPriorAnswers,
  questionId: string,
  cellId?: string,
): unknown {
  if (!prior) return undefined;
  const value = prior[questionId];
  if (cellId === undefined) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[cellId];
}

/**
 * 단답형·장문형·표 input 셀의 텍스트가 이월 값과 글자 그대로 같은가.
 * 빈 문자열은 칠하지 않는다 — 빈칸은 이월 값이 아니다.
 */
export function isPriorText(
  prior: HighlightPriorAnswers,
  questionId: string,
  value: unknown,
  cellId?: string,
): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return isUntouchedPriorValue(value, priorAnswerText(prior, questionId, cellId));
}

/**
 * 보기 상세기재(`__optTexts__`)의 텍스트가 이월 값과 같은가.
 * 보기-소스 표의 입력 셀도 같은 자리에 셀 id 로 들어 있어 한 함수가 둘을 덮는다.
 */
export function isPriorOptionTextValue(
  prior: HighlightPriorAnswers,
  questionId: string,
  optionId: string,
  value: unknown,
): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return isUntouchedPriorValue(value, priorOptionText(prior, questionId, optionId));
}

/**
 * 이 보기가 이월 선택에 들어 있는가 — 라디오·체크박스·드롭다운·표의 선택 셀 공용.
 *
 * 값 모양이 유형마다 다르다: 라디오·드롭다운·선택 셀은 문자열 하나, 체크박스는 문자열
 * 배열, 레거시 기타 보기는 `{ selectedValue }` 객체다. **체크박스가 배열이므로 판정이
 * 저절로 항목 단위가 된다** — 작년 체크는 빨강, 새로 고른 체크는 파랑이 한 문항 안에
 * 섞인다.
 *
 * 호출부는 "지금 선택돼 있는가"를 스스로 알고 있으므로 여기서 다시 보지 않는다.
 * 선택되지 않은 보기의 컨트롤에는 칠할 것이 없다.
 */
export function isPriorChoice(
  prior: HighlightPriorAnswers,
  questionId: string,
  optionKey: string,
  cellId?: string,
): boolean {
  return matchesPriorChoice(priorFragment(prior, questionId, cellId), optionKey);
}

/**
 * 이월 조각 하나를 직접 받아 판정한다 — 값이 이월 응답의 제자리에 없는 표면용.
 *
 * 보기-소스 표(`ChoiceTableResponse`) 안의 선택형 셀이 그렇다. 그 문항은 `radio`/`checkbox`
 * 라 셀 id 를 키로 하는 자리가 없어서 값이 `__optTexts__` 사이드카에 **인코딩된 문자열**로
 * 들어간다(`choice-table-cell-value.ts`). 호출부가 같은 디코더로 되돌린 조각을 넘긴다.
 */
export function matchesPriorChoice(priorValue: unknown, optionKey: string): boolean {
  if (optionKey.length === 0) return false;
  if (typeof priorValue === 'string') return priorValue === optionKey;
  if (Array.isArray(priorValue)) return priorValue.includes(optionKey);
  if (priorValue && typeof priorValue === 'object') {
    const selected = (priorValue as { selectedValue?: unknown }).selectedValue;
    return typeof selected === 'string' && selected === optionKey;
  }
  return false;
}

/**
 * 다단계 선택의 이 단계 값이 이월 값과 같은가. 값이 단계별 배열이라 인덱스로 판정한다.
 */
export function isPriorMultiSelectLevel(
  prior: HighlightPriorAnswers,
  questionId: string,
  levelIndex: number,
  value: unknown,
): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  const priorValue = priorFragment(prior, questionId);
  if (!Array.isArray(priorValue)) return false;
  return priorValue[levelIndex] === value;
}

/** 이월 값에서 순위형 응답 배열을 꺼낸다. 형태가 다르면 빈 배열. */
function priorRankingAnswers(
  prior: HighlightPriorAnswers,
  questionId: string,
  cellId?: string,
): RankingAnswer[] {
  const value = priorFragment(prior, questionId, cellId);
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is RankingAnswer =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as RankingAnswer).rank === 'number' &&
      typeof (entry as RankingAnswer).optionValue === 'string',
  );
}

/**
 * 순위형 상세기재(`optionText`)·기타 입력(`otherText`)이 이월 값과 같은가.
 *
 * 이 두 칸은 `__optTexts__` 가 아니라 `RankingAnswer` 안에 실려 있어 보기 상세기재
 * 경로(`isPriorOptionTextValue`)로는 닿지 않는다. 순위 칸을 그대로 두고 글만 고친 경우를
 * 가려내려면 순위·필드 단위로 따로 봐야 한다.
 */
export function isPriorRankingText(
  prior: HighlightPriorAnswers,
  questionId: string,
  rank: number,
  field: 'optionText' | 'otherText',
  value: unknown,
  cellId?: string,
): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  const entry = priorRankingAnswers(prior, questionId, cellId).find((a) => a.rank === rank);
  const priorText = entry?.[field];
  return isUntouchedPriorValue(value, typeof priorText === 'string' ? priorText : null);
}

/**
 * 순위형에서 이 순위에 고른 보기가 이월 값과 같은가 — 순위 칸 하나가 판정 단위다.
 * 표의 ranking 셀도 `cellId` 로 같은 함수를 쓴다.
 */
export function isPriorRanking(
  prior: HighlightPriorAnswers,
  questionId: string,
  rank: number,
  optionValue: unknown,
  cellId?: string,
): boolean {
  if (typeof optionValue !== 'string' || optionValue.length === 0) return false;
  return priorRankingAnswers(prior, questionId, cellId).some(
    (entry) => entry.rank === rank && entry.optionValue === optionValue,
  );
}
