import type { TableRow } from '@/types/survey';

/**
 * 보기 소스 표에서 상세 기재 입력칸을 **보기 칸 안**(라벨 오른쪽 같은 줄)에 그릴 보기 칸의 id
 * (CONTEXT.md 「보기 칸 안 상세 기재」). 칸 옵션 `optionTextInCell` 을 켠, 상세 기재가 있는,
 * 보이는 보기 칸이다. 화면에 보이는 격자로 투영한 행을 넘길 것 — 원본으로 판정하면 칸이 조건으로
 * 숨었을 때 입력칸이 표 아래에도 칸 안에도 안 그려진다.
 */
export function collectInCellOptionTextIds(rows: readonly TableRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const cell of row.cells) {
      if (
        cell.type === 'choice_opt' &&
        !cell.isHidden &&
        cell.optionTextInCell === true &&
        cell.allowTextInput === true
      ) {
        ids.add(cell.id);
      }
    }
  }
  return ids;
}
