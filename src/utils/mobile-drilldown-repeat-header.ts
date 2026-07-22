import type { TableRow } from '@/types/survey';
import { recalculateRowspansForVisibleRows } from '@/utils/table-merge-helpers';

export interface MobileDrilldownRepeatHeaderRange {
  startRow: number;
  endRow: number;
}

interface StoredRepeatHeaderRange {
  mobileDrilldownRepeatHeaderStartRow?: unknown;
  mobileDrilldownRepeatHeaderEndRow?: unknown;
  hideColumnLabels?: unknown;
}

export type MobileDrilldownRepeatHeaderParseResult =
  | { ok: true; value: MobileDrilldownRepeatHeaderRange | null }
  | { ok: false };

const DEFAULT_RANGE: MobileDrilldownRepeatHeaderRange = { startRow: 0, endRow: 0 };

function isValidRowNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function resolveMobileDrilldownRepeatHeaderRange(
  input: StoredRepeatHeaderRange,
): MobileDrilldownRepeatHeaderRange | null {
  const start = input.mobileDrilldownRepeatHeaderStartRow;
  const end = input.mobileDrilldownRepeatHeaderEndRow;

  if (start === undefined && end === undefined) {
    return input.hideColumnLabels === true ? null : { ...DEFAULT_RANGE };
  }
  if (start === null && end === null) return null;
  if (!isValidRowNumber(start) || !isValidRowNumber(end) || start > end) {
    return { ...DEFAULT_RANGE };
  }
  return { startRow: start, endRow: end };
}

export function parseMobileDrilldownRepeatHeaderText(
  text: string,
): MobileDrilldownRepeatHeaderParseResult {
  const normalized = text.replaceAll(/\s/g, '');
  if (normalized === '') return { ok: true, value: null };
  const match = /^(\d+)(?:-(\d+))?$/.exec(normalized);
  if (!match) return { ok: false };
  const startRow = Number(match[1]);
  const endRow = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(startRow) || !Number.isSafeInteger(endRow) || startRow > endRow) {
    return { ok: false };
  }
  return { ok: true, value: { startRow, endRow } };
}

export function formatMobileDrilldownRepeatHeaderRange(
  range: MobileDrilldownRepeatHeaderRange | null,
): string {
  if (!range) return '';
  return range.startRow === range.endRow
    ? String(range.startRow)
    : `${range.startRow}-${range.endRow}`;
}

export function includesMobileDrilldownColumnHeader(
  range: MobileDrilldownRepeatHeaderRange | null,
): boolean {
  return range?.startRow === 0;
}

export function getMobileDrilldownRepeatedBodyRowIds(
  authoredRows: TableRow[],
  range: MobileDrilldownRepeatHeaderRange | null,
): Set<string> {
  if (!range) return new Set();
  const firstBodyRow = Math.max(1, range.startRow);
  const ids = authoredRows.slice(firstBodyRow - 1, range.endRow).map((row) => row.id);
  return new Set(ids);
}

export function excludeMobileDrilldownRepeatedRows(
  displayRows: TableRow[],
  repeatedRowIds: ReadonlySet<string>,
): TableRow[] {
  const visibleIds = new Set(
    displayRows.filter((row) => !repeatedRowIds.has(row.id)).map((row) => row.id),
  );
  if (visibleIds.size === displayRows.length) return displayRows;
  return recalculateRowspansForVisibleRows(displayRows, visibleIds);
}
