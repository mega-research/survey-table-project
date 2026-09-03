/**
 * 문항을 사람이 부르는 짧은 이름. 순수 함수 — DB·React 를 모른다.
 */

/**
 * 엑셀 라벨 → 문항코드 순으로 고른다. 둘 다 없으면 null.
 *
 * 문항코드는 SPSS 변수명이라 발번 규칙을 따른다. `B6_A` 처럼 원본 조사표 어디에도
 * 없는 문자열이 되기도 해서, 조사표를 보며 답하는 화면에서는 종이와 화면이 같은 칸을
 * 서로 다른 이름으로 부르게 된다. 엑셀 라벨이 있으면 그쪽이 사람이 쓰는 이름이다.
 *
 * **문장으로 폴백하지 않는다.** 이 값이 들어가는 자리는 좁은 코드 칸이고, 문장은
 * 바로 옆 칸에 이미 있다.
 *
 * 빈 문자열도 없는 것으로 본다 — 빌더가 placeholder 만 보여 주므로 저장되지 않은
 * 칸이 `''` 로 남는 일이 흔하다.
 */
export function questionShortCode(question: {
  exportLabel?: string | null | undefined;
  questionCode?: string | null | undefined;
}): string | null {
  return question.exportLabel?.trim() || question.questionCode?.trim() || null;
}
