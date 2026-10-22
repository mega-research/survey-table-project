import { readOptTextsSidecar } from '@/lib/option-text-read';
import type { Question, SurveyLookup } from '@/types/survey';
import { collectAnswerQuotes } from '@/utils/answer-quote';
import { type BranchEvalCtx, responsesToLookupShape } from '@/utils/branch-eval';

/**
 * 조건 평가 컨텍스트의 출처 — 고정 컨텍스트, 또는 응답 뷰마다 컨텍스트를 새로 만드는 함수.
 *
 * 고정 컨텍스트는 응답 뷰만 갈아 끼우고 명단 값·LUT 은 그대로 쓴다(응답 화면이 한 번 그릴 때
 * 넘기는 것). 함수는 응답에서 파생되는 값(응답 인용값)까지 그 뷰로 다시 계산한다 — 응답 확정과
 * Raw 내보내기가 넘긴다.
 */
export type EvalCtxSource = BranchEvalCtx | ((view: Record<string, unknown>) => BranchEvalCtx);

/**
 * 응답 화면과 같은 조건 평가 컨텍스트를 응답 뷰마다 만든다 — 응답 확정·Raw 내보내기 공용.
 *
 * 응답 화면은 조건을 `{ ...명단 값, ...응답 인용값 }` 으로 푼다(인용 우선, 조건식의 `attrsKey`
 * 피연산자가 두 채널을 구분하지 못한다). 서버가 명단 값만 넘기면 명단 열과 같은 이름의 인용값을
 * 읽는 조건이 서버에서만 다르게 풀려, 화면에서 보이고 입력한 문항·행·열의 답을 지운다.
 *
 * **인용값은 받은 뷰로 매번 다시 계산한다.** 응답 화면은 매 렌더 지금 응답으로 인용값을 계산하고,
 * 숨은 값을 지운 뒤 다시 그리며 다시 계산한다. strip 고정점의 바퀴마다 이 함수를 부르면 같은
 * 수렴이 된다 — 인용값의 출처 답이 지워지면 인용값도 바뀌어 그것을 읽던 조건이 다시 풀린다.
 *
 * 상세 기재 재료는 뷰의 루트 `__optTexts__` 사이드카다. 화면은 저장분에 편집 중인 값을 얹지만
 * (`resolveEffectiveOptionTextsByQuestion`) 서버에는 저장분뿐이다 — 제출 페이로드가 편집 중인 값을
 * 이 사이드카에 담아 보내므로 같은 값이다. 응답 뷰는 원본 모양을 그대로 평탄화한다(계산 칸 값
 * 주입 없음 — 지금까지의 서버 조건 평가와 같다). 수식 평가(`withCalcValues`)는 화면도 명단 값만
 * 쓰므로 이 컨텍스트를 쓰지 않는다.
 */
export function createAnswerEvalCtx(base: {
  questions: Question[];
  contactAttrs: Record<string, string | undefined>;
  lookups: SurveyLookup[];
}): (view: Record<string, unknown>) => BranchEvalCtx {
  return (view) => ({
    responses: responsesToLookupShape(view),
    contactAttrs: {
      ...base.contactAttrs,
      ...collectAnswerQuotes(base.questions, view, readOptTextsSidecar(view)),
    },
    lookups: base.lookups,
  });
}

/**
 * 뷰에 맞춘 평가 컨텍스트. 고정 컨텍스트는 응답 뷰만 다시 만들고, 함수 출처는 뷰로 새로 만든다.
 * `origin` 이 주어지고 뷰가 그것과 같으면 고정 컨텍스트를 그대로 돌려준다(지운 것이 없는 흔한
 * 경로에서 객체를 만들지 않는다 — 호출부가 원래 하던 규칙).
 */
export function evalCtxForView(
  source: EvalCtxSource | undefined,
  view: Record<string, unknown>,
  origin?: Record<string, unknown>,
): BranchEvalCtx | undefined {
  if (!source) return undefined;
  if (typeof source === 'function') return source(view);
  if (origin !== undefined && view === origin) return source;
  return { ...source, responses: responsesToLookupShape(view) };
}
