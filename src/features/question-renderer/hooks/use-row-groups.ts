import { useMemo } from 'react';

import type { HeaderCell, TableRow } from '@/types/survey';

// ── 타입 ──

export interface RowGroup {
  label: string;
  rows: TableRow[];
  startIndex: number;
}

/** 셀 인덱스 → 섹션 라벨 매핑 (다단 헤더 기반) */
export type ColumnSectionMap = Map<number, string>;

// ── rowspan 기반 자동 그룹핑 ──

function detectRowGroups(rows: TableRow[]): RowGroup[] {
  if (rows.length === 0) return [];

  const groups: RowGroup[] = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];
    if (!row) break;
    const firstTextCell = row.cells.find(
      (c) => c.type === 'text' && !c.isHidden && (c.rowspan ?? 1) > 1,
    );

    if (firstTextCell?.rowspan && firstTextCell.rowspan > 1) {
      const span = firstTextCell.rowspan;
      groups.push({
        label: firstTextCell.content || `그룹 ${groups.length + 1}`,
        rows: rows.slice(i, i + span),
        startIndex: i,
      });
      i += span;
    } else {
      // rowspan 없는 행 → 직전 비-rowspan 그룹에 추가하거나 새 그룹
      const lastGroup = groups[groups.length - 1];
      const lastGroupHasRowspan = lastGroup?.rows.some((r) =>
        r.cells.some((c) => c.type === 'text' && !c.isHidden && (c.rowspan ?? 1) > 1),
      );

      if (lastGroup && !lastGroupHasRowspan) {
        lastGroup.rows.push(row);
      } else {
        groups.push({
          label: row.label || `항목 ${i + 1}`,
          rows: [row],
          startIndex: i,
        });
      }
      i++;
    }
  }
  return groups;
}

// ── 다단 헤더 → 셀 인덱스별 섹션 라벨 ──

function buildColumnSectionMap(headerGrid: HeaderCell[][]): ColumnSectionMap | null {
  if (headerGrid.length < 2) return null;

  // 마지막에서 2번째 행 = 섹션 레벨 (예: "자가 제재용 원목")
  const sectionRow = headerGrid[headerGrid.length - 2];
  if (!sectionRow) return null;
  const map: ColumnSectionMap = new Map();
  let colIdx = 0;

  for (const cell of sectionRow) {
    const span = cell.colspan || 1;
    if ((cell.rowspan ?? 1) <= 1 && span > 1) {
      map.set(colIdx, cell.label);
    }
    colIdx += span;
  }

  return map.size > 0 ? map : null;
}

// ── 훅 ──

export function useRowGroups(displayRows: TableRow[]) {
  return useMemo(() => detectRowGroups(displayRows), [displayRows]);
}

export function useColumnSectionMap(headerGrid?: HeaderCell[][] | null) {
  return useMemo(
    () => (headerGrid ? buildColumnSectionMap(headerGrid) : null),
    [headerGrid],
  );
}
