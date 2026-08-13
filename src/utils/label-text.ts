/**
 * 옵션 라벨 줄바꿈은 표시 전용 — 통계 납품물(SPSS value label, 엑셀 export 라벨)은
 * 단일 행 라벨을 유지한다. (CONTEXT.md "옵션 라벨 줄바꿈")
 */
export function toSingleLineLabel(label: string): string {
  return label.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}
