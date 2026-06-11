import type { TableCell, TableRow } from '@/types/survey';

// 완료 판정 대상이 되는 입력 셀 타입
const ANSWERABLE_CELL_TYPES = ['text', 'checkbox', 'radio', 'select', 'input'] as const;

/**
 * 셀 응답값이 "응답됨"으로 간주되는지 여부.
 * undefined/null/빈 문자열은 미응답으로 본다.
 */
function isCellAnswered(val: unknown): boolean {
  return val !== undefined && val !== null && val !== '';
}

/**
 * 같은 행 + 같은 radioGroupName 셀들(멤버 ≥ 2)을 single-select 그룹으로 묶는다.
 * 렌더 경로(resolveRadioGroupProps)와 동일하게 isHidden 셀은 제외하고, 멤버가 2개 이상일 때만 그룹으로 본다.
 * 반환: radioGroupName -> 그룹 멤버 cell.id 목록(2개 이상).
 */
function buildRadioGroupBuckets(row: TableRow): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const c of row.cells) {
    if (c.type !== 'radio' || c.isHidden || !c.radioGroupName) continue;
    const list = buckets.get(c.radioGroupName) ?? [];
    list.push(c.id);
    buckets.set(c.radioGroupName, list);
  }
  // 멤버가 1개뿐이면 그룹으로 묶을 의미가 없으므로 제거
  for (const [name, ids] of buckets) {
    if (ids.length < 2) buckets.delete(name);
  }
  return buckets;
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
): boolean {
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
    if (!ANSWERABLE_CELL_TYPES.includes(cell.type as (typeof ANSWERABLE_CELL_TYPES)[number])) {
      return true;
    }
    // single-select radio 그룹 멤버는 그룹 단위로 판정
    const groupName = cellGroupName.get(cell.id);
    if (groupName) {
      return groupCompleted.get(groupName) ?? false;
    }
    return isCellAnswered(response[cell.id]);
  });
}
