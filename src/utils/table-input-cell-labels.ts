import type { TableCell, TableRow } from '@/types/survey';

/**
 * 표 입력 칸의 이름 — 칸 id → 이름, 표 순서(행 → 열)대로.
 *
 * 이름은 양식형 표에서 읽히는 그대로 같은 행에서 그 칸 앞의 마지막 글자 칸(첫 줄)이다
 * (「(8) 법인등록번호」). 같은 글자 칸 뒤에 입력 칸이 여럿이면 몇 번째 칸인지 붙이고, 앞 글자
 * 칸이 없으면 행 이름, 그것도 없으면 위치로 부른다. 병합에 가려진 칸은 뺀다.
 * 「목록에서 찾기」 채울 칸 목록(빌더)과 응답 내역 응답값 열 후보(서버)가 같이 쓴다.
 * `types` 로 이름 붙일 칸 종류를 바꾼다(기본 입력 칸) — 응답값 열 후보는 선택 칸(단일·드롭다운·체크박스)도
 * 따로 부른다. 「n번째 칸」은 같은 종류끼리 센다.
 */
export function tableInputCellLabels(
  rows: readonly TableRow[],
  types: readonly TableCell['type'][] = ['input'],
): Map<string, string> {
  const labels = new Map<string, string>();
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
      if (!types.includes(cell.type)) return;
      inputsSinceText += 1;
      const base = lastText || row.label?.trim() || `${rowIndex + 1}행 ${colIndex + 1}열`;
      labels.set(
        cell.id,
        lastText && inputsSinceText > 1 ? `${base} (${inputsSinceText}번째 칸)` : base,
      );
    });
  });
  return labels;
}
