import type { NumericComparison, SurveyLookup } from '@/types/survey';
import {
  evaluateComparisonWithFailSafe,
  type ComparisonResult,
} from '@/lib/lookup/evaluate-comparison';
import type { LookupEvalCtx } from '@/lib/lookup/types';

/**
 * 분기 평가의 leaf 의존 모듈.
 *
 * branch-logic 과 table-cell-semantics 가 모두 의존하는 최하층 — 순환 import 차단을 위해
 * BranchEvalCtx / emptyBranchEvalCtx / evaluateNumericComparisonV2 를 branch-logic 에서 이동.
 * 기존 외부 import 호환을 위해 branch-logic 이 re-export 한다.
 */

/**
 * 분기 평가 컨텍스트. displayCondition / BranchRule 의 우변에 LUT 룩업이 등장할 때,
 * 응답 페이지나 빌더 미리보기 호출처에서 응답 전체 + 컨택 attrs + LUT 사본을 주입한다.
 *
 * - 응답 페이지: survey snapshot 의 lookups + ContactAttrsProvider 의 attrs + 누적 responses
 * - 빌더 미리보기: currentSurvey.lookups + sample 컨택 attrs + testResponses
 * - 미주입(undefined): lookup 우변이 평가 불가능 → fail-safe SHOW 동작 (의도된 안전 기본값)
 */
export type BranchEvalCtx = {
  responses: Record<string, Record<string, string | undefined>>;
  contactAttrs: Record<string, string | undefined>;
  lookups: SurveyLookup[];
};

export const emptyBranchEvalCtx = (): BranchEvalCtx => ({
  responses: {},
  contactAttrs: {},
  lookups: [],
});

/**
 * NumericComparison 평가 진입점 (T16~).
 * - `cmp.left` 미존재(legacy 데이터) 시 cellValue 를 "현재 평가 중인 셀" 로 wrap 하여 cell-impersonation.
 * - fail-safe 적용된 ComparisonResult 반환. 단순 boolean 이 필요한 곳은 `.satisfied` 사용.
 */
export function evaluateNumericComparisonV2(
  cmp: NumericComparison,
  cellValue: string,
  ctx: BranchEvalCtx,
): ComparisonResult {
  if (!cmp.left) {
    const fakeQ = '__current__';
    const fakeC = '__current__';
    const wrapped: NumericComparison = {
      ...cmp,
      left: { kind: 'cell', questionId: fakeQ, cellId: fakeC },
    };
    const evalCtx: LookupEvalCtx = {
      ...ctx,
      responses: {
        ...ctx.responses,
        [fakeQ]: { ...(ctx.responses[fakeQ] ?? {}), [fakeC]: cellValue },
      },
    };
    return evaluateComparisonWithFailSafe(wrapped, evalCtx);
  }
  return evaluateComparisonWithFailSafe(cmp, ctx);
}
