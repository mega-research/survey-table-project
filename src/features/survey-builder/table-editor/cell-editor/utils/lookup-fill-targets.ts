import type { TableRow } from '@/types/survey';

export interface LookupFillTarget {
  cellId: string;
  label: string;
}

/**
 * 「목록에서 찾기」 채울 칸 후보 — 같은 표의 응답자가 보는 입력 칸(자기 자신 제외).
 *
 * 이름은 양식형 표에서 읽히는 그대로 같은 행에서 그 칸 앞의 마지막 글자 칸(첫 줄)이다
 * (「(8) 법인등록번호」). 같은 글자 칸 뒤에 입력 칸이 여럿이면 몇 번째 칸인지 붙이고, 앞 글자
 * 칸이 없으면 행 이름, 그것도 없으면 위치로 부른다.
 */
export function listLookupFillTargets(
  rows: readonly TableRow[],
  ownCellId: string,
): LookupFillTarget[] {
  const targets: LookupFillTarget[] = [];
  rows.forEach((row, rowIndex) => {
    let lastText = '';
    let inputsSinceText = 0;
    row.cells.forEach((cell, colIndex) => {
      if (cell.isHidden) return;
      if (cell.type === 'text') {
        const firstLine = (cell.content ?? '').split('\n')[0]?.trim() ?? '';
        if (firstLine !== '') {
          lastText = firstLine;
          inputsSinceText = 0;
        }
        return;
      }
      if (cell.type !== 'input') return;
      inputsSinceText += 1;
      if (cell.id === ownCellId) return;
      const base = lastText || row.label?.trim() || `${rowIndex + 1}행 ${colIndex + 1}열`;
      const label = lastText && inputsSinceText > 1 ? `${base} (${inputsSinceText}번째 칸)` : base;
      targets.push({ cellId: cell.id, label });
    });
  });
  return targets;
}
