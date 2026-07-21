import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

/**
 * 모바일 테이블 드릴다운용 표 구조 자동 분류기.
 *
 * 데스크탑 표의 rowspan/colspan/다단 헤더만 보고 "여긴 매트릭스, 여긴 단순 입력"을
 * 판별한다. 응답 키는 전부 cell.id 이므로 기존 응답 형식과 그대로 호환된다.
 *
 * 입력은 displayCondition·동적행 필터링과 colspan/rowspan 재계산을 이미 거친
 * visibleColumns / displayRows / visibleHeaderGrid 를 받는다.
 */
export interface ClassifyInput {
  tableColumns: TableColumn[];
  tableRowsData: TableRow[];
  tableHeaderGrid?: HeaderCell[][] | null | undefined;
  answerableCellTypes?: readonly TableCell['type'][] | undefined;
}

export const DEFAULT_TABLE_ANSWERABLE_CELL_TYPES = [
  'input',
  'radio',
  'checkbox',
  'select',
  'ranking',
] as const satisfies readonly TableCell['type'][];

function answerableTypes(q: ClassifyInput): ReadonlySet<TableCell['type']> {
  return new Set(q.answerableCellTypes ?? DEFAULT_TABLE_ANSWERABLE_CELL_TYPES);
}

function isInput(cell: TableCell | undefined, types: ReadonlySet<TableCell['type']>) {
  return !!cell && !cell.isHidden && !cell._isContinuation && types.has(cell.type);
}
const isLabel = (c?: TableCell) =>
  !!c && !c.isHidden && (c.type === 'text' || c.type === 'image' || c.type === 'video');

export type SectionKind = 'matrix' | 'list' | 'scalar';
export interface ColGroup {
  label: string;
  cols: { col: number; label: string }[];
}
export interface ClassifiedLeaf {
  rowId: string;
  label: string;
  subGroup: string;
  subGroupSourceCellId?: string | undefined;
  inputCellIds: string[];
  // 실제 열 인덱스 → 입력 셀 id. matrix 폼은 colGroups 의 col(실제 열 인덱스)로 셀을 찾는다.
  // inputCellIds 는 행마다 길이가 다를 수 있어(비대칭 matrix) 위치로 끼워맞추면 밀린다.
  cellByCol: Record<number, string>;
}
export interface ClassifiedSection {
  label: string;
  kind: SectionKind;
  reason: string;
  leaves: ClassifiedLeaf[];
  colGroups: ColGroup[];
  totalInputs: number;
}

// 값 열(입력 있는 열) 판별 — cells 배열 인덱스 === 열 인덱스
function valueColumns(q: ClassifyInput, types = answerableTypes(q)): number[] {
  const n = q.tableColumns.length;
  const isVal = new Array(n).fill(false);
  for (const row of q.tableRowsData)
    row.cells.forEach((c, j) => {
      if (isInput(c, types)) isVal[j] = true;
    });
  return isVal.flatMap((v, j) => (v ? [j] : []));
}

// 한 라벨 열의 rowspan 으로 행 그룹핑 (use-row-groups 의 detectRowGroups 일반화)
function groupByColumn(rows: TableRow[], col: number) {
  const groups: { label: string; rows: TableRow[]; sourceCellId?: string | undefined }[] = [];
  for (let i = 0; i < rows.length; ) {
    const row = rows[i];
    if (!row) break;
    const c = row.cells[col];
    const span = c && !c.isHidden && (c.rowspan ?? 1) > 1 ? (c.rowspan ?? 1) : 1;
    groups.push({
      label: (c?.content ?? '').trim(),
      rows: rows.slice(i, i + span),
      ...(c ? { sourceCellId: c.id } : {}),
    });
    i += span;
  }
  return groups;
}

// 다단 헤더 → 각 열의 라벨 경로(상위→하위)
function columnPaths(grid: HeaderCell[][], n: number): string[][] {
  const paths: string[][] = Array.from({ length: n }, () => []);
  const occ = Array.from({ length: grid.length }, () => new Set<number>());
  grid.forEach((cells, r) => {
    const occRow = occ[r];
    if (!occRow) return;
    let col = 0;
    for (const cell of cells) {
      while (occRow.has(col)) col++;
      const cs = cell.colspan || 1;
      const rs = cell.rowspan || 1;
      for (let rr = r; rr < r + rs; rr++) for (let cc = col; cc < col + cs; cc++) occ[rr]?.add(cc);
      for (let cc = col; cc < col + cs; cc++) {
        const path = paths[cc];
        if (path) path[r] = cell.label;
      }
      col += cs;
    }
  });
  return paths.map((p) => p.filter(Boolean));
}

function buildColGroups(q: ClassifyInput, vcols: number[]): ColGroup[] {
  const grid = q.tableHeaderGrid;
  if (!grid || grid.length < 2)
    return [
      { label: '', cols: vcols.map((j) => ({ col: j, label: q.tableColumns[j]?.label ?? '' })) },
    ];
  const paths = columnPaths(grid, q.tableColumns.length);
  const groups: ColGroup[] = [];
  for (const j of vcols) {
    const p = paths[j] ?? [];
    const leaf = p[p.length - 1] ?? q.tableColumns[j]?.label ?? '';
    const parent = p.length >= 2 ? (p[p.length - 2] ?? '') : '';
    let g = groups[groups.length - 1];
    if (!g || g.label !== parent) groups.push((g = { label: parent, cols: [] }));
    g.cols.push({ col: j, label: leaf });
  }
  return groups;
}

const rightmostLabel = (row: TableRow, labelCols: number[]) => {
  for (let k = labelCols.length - 1; k >= 0; k--) {
    const colIdx = labelCols[k];
    if (colIdx === undefined) continue;
    const c = row.cells[colIdx];
    // rowspan 으로 병합된 라벨 셀의 첫 행 content 는 그룹 전체를 대표하는 라벨이라
    // 개별 행(리프)을 구분하지 못한다. 이런 셀은 건너뛰고 row.label 로 떨어진다.
    if (isLabel(c) && c?.content.trim() && (c?.rowspan ?? 1) <= 1) return c.content.trim();
  }
  return row.label || '';
};

export function classifyTable(q: ClassifyInput): ClassifiedSection[] {
  const types = answerableTypes(q);
  const cols = q.tableColumns;
  const rows = q.tableRowsData;
  const vcols = valueColumns(q, types);
  const V = vcols.length;
  const labelCols = cols.map((_, j) => j).filter((j) => !vcols.includes(j));
  const leftmost = labelCols[0] ?? 0; // 목차(섹션) 열
  const subCol = labelCols[1]; // 매트릭스 하위 그룹 열
  const colGroups = buildColGroups(q, vcols);
  const colMeta = new Map<number, { group: string; leaf: string }>();
  colGroups.forEach((g) =>
    g.cols.forEach((c) => colMeta.set(c.col, { group: g.label, leaf: c.label })),
  );

  return groupByColumn(rows, leftmost).map((sec) => {
    const usedPerRow = sec.rows.map((row) =>
      vcols.filter((column) => isInput(row.cells[column], types)),
    );
    const inputRows = sec.rows.filter((row) => row.cells.some((cell) => isInput(cell, types)));

    let kind: SectionKind;
    let reason: string;
    if (usedPerRow.some((u) => u.length >= 2)) {
      kind = 'matrix';
      reason = `값 열 ${V}개를 행마다 채움`;
    } else if (V >= 2) {
      kind = 'scalar';
      reason = `입력 1칸이 값 열 ${V}개를 colspan 병합`;
    } else if (inputRows.length <= 1) {
      kind = 'scalar';
      reason = '값 열 1개 · 단독 입력';
    } else {
      kind = 'list';
      reason = `값 열 1개 · 반복 항목 ${inputRows.length}개`;
    }

    const subGroups =
      subCol != null ? groupByColumn(sec.rows, subCol) : [{ label: '', rows: sec.rows }];
    const subOf = (row: TableRow) => subGroups.find((g) => g.rows.includes(row));

    const leaves: ClassifiedLeaf[] = inputRows.map((row) => {
      const subGroup = subOf(row);
      const cellByCol: Record<number, string> = {};
      row.cells.forEach((cell, columnIndex) => {
        if (isInput(cell, types)) cellByCol[columnIndex] = cell.id;
      });
      return {
        rowId: row.id,
        label: rightmostLabel(row, labelCols),
        subGroup: subGroup?.label ?? '',
        ...(subGroup?.sourceCellId ? { subGroupSourceCellId: subGroup.sourceCellId } : {}),
        inputCellIds: row.cells.filter((cell) => isInput(cell, types)).map((cell) => cell.id),
        cellByCol,
      };
    });

    return {
      label: sec.label,
      kind,
      reason,
      leaves,
      colGroups,
      totalInputs: leaves.reduce((s, l) => s + l.inputCellIds.length, 0),
    };
  });
}

export interface DrilldownDecision {
  useDrilldown: boolean;
  sections: ClassifiedSection[];
  labelColCount: number;
}

/**
 * 모바일에서 드릴다운을 쓸지 판정.
 * 다단계 행 계층(라벨 열 2개+) · 매트릭스 섹션 · rowspan 으로 묶인 그룹/반복(리프 2개+ 섹션)이
 * 하나라도 있으면 드릴다운. 완전 평면(단일 라벨 열 · 단일행 섹션 · 비매트릭스)은 기존 스테퍼.
 */
/** 인터랙티브(입력) 셀이 이 개수 이하면 드릴다운 없이 기존 카드/스테퍼를 쓴다. */
export const DRILLDOWN_MIN_INPUTS = 15;

export function decideDrilldown(q: ClassifyInput): DrilldownDecision {
  const vcols = valueColumns(q);
  const labelColCount = q.tableColumns.length - vcols.length;
  const sections = classifyTable(q);
  const totalInputs = sections.reduce((a, s) => a + s.totalInputs, 0);
  const useDrilldown =
    totalInputs > DRILLDOWN_MIN_INPUTS &&
    (labelColCount >= 2 ||
      sections.some((s) => s.kind === 'matrix') ||
      sections.some((s) => s.leaves.length >= 2));
  return { useDrilldown, sections, labelColCount };
}
