/** 응답이 끝난 방식 — CONTEXT.md 「종료 결과」. 쿼터마감은 별도 차단 화면이라 여기 없다. */
export type CompletionOutcome = 'completed' | 'screened_out';

export const SCREENED_OUT_TITLE = '설문 종료';
export const COMPLETED_TITLE = '응답 완료!';

/**
 * 종료 결과에 맞는 완료 화면 제목·문구.
 * 자격미달은 「자격미달 종료 문구」를 쓰되 비어 있으면 완료 문구로 폴백한다 — 기존 설문은
 * 채우기 전까지 아무것도 달라지지 않는다. 제목은 고정값이다(CONTEXT.md 「자격미달 종료 문구」).
 */
export function resolveCompletionScreen(
  settings: { thankYouMessage: string; screenedOutMessage?: string | null | undefined },
  outcome: CompletionOutcome,
): { title: string; message: string } {
  if (outcome === 'screened_out') {
    const custom = settings.screenedOutMessage?.trim();
    return { title: SCREENED_OUT_TITLE, message: custom || settings.thankYouMessage };
  }
  return { title: COMPLETED_TITLE, message: settings.thankYouMessage };
}

/** complete 결과 행의 상태 → 종료 결과. 알 수 없는 값은 완료로 본다(기존 동작 보존). */
export function outcomeFromStatus(status: string | null | undefined): CompletionOutcome {
  return status === 'screened_out' ? 'screened_out' : 'completed';
}
