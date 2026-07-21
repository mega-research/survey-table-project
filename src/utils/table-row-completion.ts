import type { TableCell, TableRow } from '@/types/survey';
import { parseRankingAnswers } from '@/utils/ranking-shared';
import { buildRadioGroupBuckets } from '@/utils/table-radio-groups';

// 완료 판정 대상이 되는 입력 셀 타입
const DEFAULT_ANSWERABLE_CELL_TYPES = ['text', 'checkbox', 'radio', 'select', 'input'] as const;

/**
 * 셀 응답값이 "응답됨"으로 간주되는지 여부.
 * undefined/null/빈 문자열은 미응답으로 본다.
 */
function isCellAnswered(val: unknown, cellType?: TableCell['type']): boolean {
  if (cellType === 'ranking') return parseRankingAnswers(val).length > 0;
  return val !== undefined && val !== null && val !== '';
}

/**
 * 테이블 행이 모두 응답되었는지 판정한다.
 *
 * single-select radio 그룹(같은 행 + 같은 radioGroupName, 멤버 ≥ 2)은 멤버 중 하나만 선택되면
 * 나머지 sibling 셀이 ''(빈 문자열)로 클리어된다(use-cell-response.ts sibling-clear).
 * 따라서 셀 단위로 `val !== ''`를 요구하면 정상적으로 응답한 그룹도 영구 미완료가 된다.
 * 그룹은 멤버 중 하나라도 응답되면 완료로 본다.
 */
export function isTableRowCompleted(
  row: TableRow,
  response: Record<string, unknown>,
  answerableCellTypes: readonly TableCell['type'][] = DEFAULT_ANSWERABLE_CELL_TYPES,
): boolean {
  const answerable = new Set<TableCell['type']>(answerableCellTypes);
  const groupBuckets = buildRadioGroupBuckets(row);

  // 그룹별 완료 여부를 미리 계산 (멤버 중 하나라도 응답되면 완료)
  const groupCompleted = new Map<string, boolean>();
  for (const [name, ids] of groupBuckets) {
    groupCompleted.set(
      name,
      ids.some((id) => isCellAnswered(response[id])),
    );
  }
  // cell.id -> 소속 그룹 이름 (그룹 멤버 셀은 그룹 단위로 판정하기 위함)
  const cellGroupName = new Map<string, string>();
  for (const [name, ids] of groupBuckets) {
    for (const id of ids) cellGroupName.set(id, name);
  }

  return row.cells.every((cell: TableCell) => {
    if (cell._isContinuation) return true;
    // isHidden 셀은 렌더되지 않아(interactive-table-response 의 isHidden return null) 응답이 불가능하다.
    // buildRadioGroupBuckets 도 isHidden 을 제외하므로 완료 판정도 동일하게 제외해 정합을 맞춘다.
    // (colspan 병합으로 숨겨진 answerable 셀이 미응답으로 남아 행을 영구 미완료로 만드는 비대칭 방지.)
    if (cell.isHidden) return true;
    if (!answerable.has(cell.type)) return true;
    // single-select radio 그룹 멤버는 그룹 단위로 판정
    const groupName = cellGroupName.get(cell.id);
    if (groupName) {
      return groupCompleted.get(groupName) ?? false;
    }
    return isCellAnswered(response[cell.id], cell.type);
  });
}
