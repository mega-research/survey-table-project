import type { TableRow } from '@/types/survey';

/**
 * 표 input 셀의 개인정보 암호화 플래그(TableCell.piiEncrypted) 수집 — 응답 저장 경로가
 * 암호화할 셀 id 목록. 스냅샷 쪽 SQL(jsonpath `$.tableRowsData[*].cells[*] ? (@.type == "input"
 * && @.piiEncrypted == true).id`)과 같은 규칙이어야 한다 (response.service 참조).
 */
export function collectPiiCellIds(rows: readonly TableRow[] | null | undefined): string[] {
  const ids: string[] = [];
  for (const row of rows ?? []) {
    for (const cell of row.cells ?? []) {
      if (cell.type === 'input' && cell.piiEncrypted === true) ids.push(cell.id);
    }
  }
  return ids;
}
