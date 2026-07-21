import type { TableCell, TableRow } from '@/types/survey';

export function buildRadioGroupBuckets(row: TableRow): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const cell of row.cells) {
    if (
      cell.type !== 'radio' ||
      cell.isHidden ||
      cell._isContinuation ||
      !cell.radioGroupName
    ) {
      continue;
    }
    const members = buckets.get(cell.radioGroupName) ?? [];
    members.push(cell.id);
    buckets.set(cell.radioGroupName, members);
  }
  return buckets;
}

export function resolveRadioGroupProps(
  cell: TableCell,
  rowId: string,
  buckets: Map<string, string[]>,
): { groupName?: string; siblingCellIds?: string[] } {
  if (cell.type !== 'radio' || !cell.radioGroupName) return {};
  const members = buckets.get(cell.radioGroupName);
  if (!members || members.length < 2) return {};
  return {
    groupName: `${rowId}-${cell.radioGroupName}`,
    siblingCellIds: members.filter((id) => id !== cell.id),
  };
}
