/**
 * 토큰 프리필로 잠긴 칸인가. 렌더러가 `disabled` 로 그리는 판정과 같은 식이다
 * (`question-input.tsx` · `question-renderer/cells/input-cell.tsx`).
 *
 * 잠긴 칸은 차단 검증 대상이 아니다 — 응답자가 고칠 수 없는 값(명단에서 온 외국 번호 등)으로
 * 진행을 막으면 따를 수 있는 길이 없다. 형식 검사·응답 품질 검사·이월 면제가 모두 같은
 * 원칙을 쓴다. 값이 유효하면 저장 경계가 정규형으로 정돈한다(`normalizeFormatValues`).
 *
 * 문항 레벨(`numeric-validation`·`format-normalize`)과 셀 레벨(`cell-text-quality`)이 함께
 * 부르므로 사슬 최하단인 renderer/utils 가 소유한다 (AGENTS.md "src/lib 잔류 기준").
 */
export function isTokenPrefilled(template: string | null | undefined): boolean {
  return (template ?? '').trim().length > 0;
}
