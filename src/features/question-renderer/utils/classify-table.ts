import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { buildTableRowspanCoverage } from '@/features/question-renderer/utils/table-rowspan-coverage';

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
  // 계산 셀만 있는 행(합계 표시 행 등)도 leaf 로 만들지 여부. 입력 드릴다운
  // (mobile-table-drilldown)만 켠다 — 행 선택 UI(choice-table-drilldown)가 켜면
  // 선택 불가능한 유령 행이 목록에 생긴다.
  includeCalcOnlyLeaves?: boolean | undefined;
  // 셀의 「모바일 카드 표시」를 분류에 반영할지 여부 — 들여쓰기 표시 셀(빈 글자 셀 + 숨기기)로
  // 섹션을 행 단위로 쪼개 묶음 머리를 세우고, 설명 셀(바로표시·자세히)을 행 제목 후보에서 뺀다.
  // 입력 드릴다운만 켠다. 끄면 결과가 종전과 같다.
  readMobileDisplay?: boolean | undefined;
  // 묶음 머리 판정용 저작 행 전체. 표시조건·동적 행으로 걸러진 tableRowsData 만 보면 하위가 전부
  // 숨겨졌을 때 "원래 머리였다" 는 사실을 알 수 없다. 없으면 tableRowsData 를 저작 구조로 본다.
  authoredRows?: TableRow[] | undefined;
  // authoredRows 의 열 정의 — 조건부로 숨은 열이 있으면 저작 행의 셀 인덱스가 tableColumns 와
  // 어긋나므로 목차 열을 열 id 로 찾는다. 없으면 인덱스가 같다고 본다.
  authoredColumns?: TableColumn[] | undefined;
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

// 들여쓰기 표시 셀 — 내용이 빈 글자 셀이 「숨기기」 상태인 것. 목차 열에서 이 셀이 덮는 행들은
// 한 섹션으로 뭉치지 않고 각자 섹션이 된다 (CONTEXT.md "들여쓰기 표시 셀").
// 미지정도 숨기기로 본다 — 글자 셀의 기본값이 숨기기이고, 셀 편집 모달은 한 번도 다른 값을
// 가진 적 없는 셀에 'hidden' 을 쓰지 않아(미지정으로 둔다) 저작자 눈에는 둘이 같은 상태다.
const isIndentMarker = (c?: TableCell) =>
  !!c &&
  c.type === 'text' &&
  (c.mobileDisplay === undefined || c.mobileDisplay === 'hidden') &&
  !(c.content ?? '').trim();
// 설명 셀 — 「바로표시」·「자세히」로 지정한 표시 셀. 행 제목이 아니라 설명으로 쓰인다.
const isDescription = (c?: TableCell) =>
  isLabel(c) && (c?.mobileDisplay === 'inline' || c?.mobileDisplay === 'collapsed');

export type SectionKind = 'matrix' | 'list' | 'scalar';
// default = 누르는 목차 카드 · group-head = 하위 섹션을 품는 묶음 머리(계산 전용 행) ·
// calc-summary = 머리가 아닌 계산 전용 섹션(합계 등). 뒤의 둘은 목차에서 값만 보이고 들어가지 않는다.
export type SectionRole = 'default' | 'group-head' | 'calc-summary';
export interface ColGroup {
  label: string;
  cols: { col: number; label: string }[];
}
export interface ClassifiedLeaf {
  rowId: string;
  label: string;
  labelSourceCellId?: string | undefined;
  subGroup: string;
  subGroupSourceCellId?: string | undefined;
  inputCellIds: string[];
  // 읽기 전용 계산 셀 id — 드릴다운에서 표시만 하고 완료 판정에는 넣지 않는다
  // (calc 는 응답이 아니므로 inputCellIds/totalInputs 에 섞으면 완료가 영구히 안 찬다).
  calcCellIds: string[];
  // 실제 열 인덱스 → 입력 셀 id. matrix 폼은 colGroups 의 col(실제 열 인덱스)로 셀을 찾는다.
  // inputCellIds 는 행마다 길이가 다를 수 있어(비대칭 matrix) 위치로 끼워맞추면 밀린다.
  cellByCol: Record<number, string>;
  // 설명 셀 id — readMobileDisplay 일 때만 채워진다. 세로 병합된 설명은 덮인 행 모두에 실린다.
  descriptionCellIds: string[];
}
export interface ClassifiedSection {
  label: string;
  labelSourceCellId?: string | undefined;
  kind: SectionKind;
  reason: string;
  leaves: ClassifiedLeaf[];
  colGroups: ColGroup[];
  totalInputs: number;
  role: SectionRole;
  // 묶음 머리 행 id — 머리 섹션 자신과 그 하위 섹션이 같은 값을 갖는다.
  groupHeadRowId?: string | undefined;
  // 들여쓰기 표시 셀로 쪼갠 섹션의 식별자. 쪼갠 섹션들은 목차 열의 출처 셀을 공유하므로
  // labelSourceCellId 로는 서로를 구분할 수 없다.
  identity?: string | undefined;
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
function groupByColumn(
  rows: TableRow[],
  col: number,
  coverage: Map<string, Array<TableCell | undefined>>,
) {
  const groups: { label: string; rows: TableRow[]; sourceCellId?: string | undefined }[] = [];
  for (let i = 0; i < rows.length; ) {
    const row = rows[i];
    if (!row) break;
    const c = coverage.get(row.id)?.[col] ?? row.cells[col];
    let end = i + 1;
    while (c && end < rows.length) {
      const nextRow = rows[end];
      if (!nextRow || coverage.get(nextRow.id)?.[col]?.id !== c.id) break;
      end += 1;
    }
    groups.push({
      label: (c?.content ?? '').trim(),
      rows: rows.slice(i, end),
      ...(c ? { sourceCellId: c.id } : {}),
    });
    i = end;
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

/** 각 열의 맨 아래 헤더 라벨 — 다단 헤더면 경로의 마지막, 아니면 열 라벨. 계산 셀 값의 라벨용. */
export function columnLeafLabels(
  q: Pick<ClassifyInput, 'tableColumns' | 'tableHeaderGrid'>,
): string[] {
  const grid = q.tableHeaderGrid;
  const paths = grid && grid.length >= 2 ? columnPaths(grid, q.tableColumns.length) : [];
  return q.tableColumns.map((column, j) => paths[j]?.[paths[j].length - 1] ?? column.label ?? '');
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

const rightmostLabel = (
  row: TableRow,
  labelCols: number[],
  coverage: Map<string, Array<TableCell | undefined>>,
  skip: (cell: TableCell | undefined) => boolean = () => false,
): { label: string; sourceCellId?: string | undefined } => {
  const coveredCells = coverage.get(row.id) ?? row.cells;
  for (let k = labelCols.length - 1; k >= 0; k--) {
    const colIdx = labelCols[k];
    if (colIdx === undefined) continue;
    const c = coveredCells[colIdx];
    if (skip(c)) continue;
    // rowspan 으로 병합된 라벨 셀의 첫 행 content 는 그룹 전체를 대표하는 라벨이라
    // 개별 행(리프)을 구분하지 못한다. 이런 셀은 건너뛰고 row.label 로 떨어진다.
    if (isLabel(c) && c?.content.trim() && (c?.rowspan ?? 1) <= 1) {
      return { label: c.content.trim(), sourceCellId: c.id };
    }
  }
  const rowLabel = row.label.trim();
  if (!rowLabel) return { label: '' };
  // row.label 이 건너뛴 셀(설명 등)의 복제본이면 제목으로 되살리지 않는다.
  if (coveredCells.some((c) => skip(c) && c?.content.trim() === rowLabel)) return { label: '' };

  // row.label이 셀 콘텐츠의 복제본인 경우 source identity를 함께 보존한다.
  // 같은 문자열을 가진 다른 hidden 셀이 있더라도 전역 문자열 비교로 라벨을 숨기지 않는다.
  for (let k = labelCols.length - 1; k >= 0; k--) {
    const colIdx = labelCols[k];
    if (colIdx === undefined) continue;
    const source = coveredCells[colIdx];
    if (isLabel(source) && source?.content.trim() === rowLabel) {
      return { label: rowLabel, sourceCellId: source.id };
    }
  }
  return { label: rowLabel };
};

export function classifyTable(q: ClassifyInput): ClassifiedSection[] {
  const types = answerableTypes(q);
  const cols = q.tableColumns;
  const rows = q.tableRowsData;
  const coverage = buildTableRowspanCoverage(rows);
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

  const readDisplay = q.readMobileDisplay === true;
  const skipForTitle = (c: TableCell | undefined) =>
    readDisplay && (isDescription(c) || isIndentMarker(c));
  const hasInput = (row: TableRow) => row.cells.some((cell) => isInput(cell, types));
  const hasCalc = (row: TableRow) =>
    row.cells.some((cell) => cell.type === 'calc' && !cell.isHidden && !cell._isContinuation);

  // 들여쓰기 표시 셀 → 바로 윗행(저작 구조 기준). 머리 후보는 계산 셀만 있는 행이어야 한다.
  const headRowIdByMarker = new Map<string, string>();
  if (readDisplay) {
    const authored = q.authoredRows ?? rows;
    // 목차 열에 놓인 들여쓰기 표시 셀만 본다 — 다른 열의 빈 숨김 셀은 묶음과 무관하다.
    const tocColumnId = cols[leftmost]?.id;
    const authoredTocIndex = q.authoredRows && q.authoredColumns
      ? q.authoredColumns.findIndex((column) => column.id === tocColumnId)
      : leftmost;
    authored.forEach((row, i) => {
      const above = authored[i - 1];
      const cell = row.cells[authoredTocIndex];
      if (!above || !cell || hasInput(above) || !hasCalc(above)) return;
      if (cell.isHidden || cell._isContinuation || !isIndentMarker(cell)) return;
      // 하위에 입력 행이 하나도 없는 묶음(계산 행 아래의 계산 행)은 소계-하위 관계가 아니다.
      const covered = authored.slice(i, i + Math.max(1, cell.rowspan ?? 1));
      if (!covered.some(hasInput)) return;
      // 동적 행 앵커가 병합 한가운데를 가르면 뒤 세그먼트는 덮인 자리의 셀 id 로 시작 셀이 된다 —
      // 그 id 로도 같은 머리를 찾도록 덮인 자리까지 등록한다.
      for (const coveredRow of covered) {
        const coveredCell = coveredRow.cells[authoredTocIndex];
        if (coveredCell) headRowIdByMarker.set(coveredCell.id, above.id);
      }
    });
  }
  const headCandidateRowIds = new Set(headRowIdByMarker.values());

  type RowGroup = ReturnType<typeof groupByColumn>[number] & {
    identity?: string;
    markerCellId?: string;
  };
  const baseGroups: RowGroup[] = groupByColumn(rows, leftmost, coverage);
  // 머리가 될 수 있는 것은 스스로 한 행짜리 섹션인 행뿐이다 — 다른 세로 병합 묶음의 일부면 제외.
  const singleRowGroupRowIds = new Set(
    baseGroups.flatMap((g) => (g.rows.length === 1 && g.rows[0] ? [g.rows[0].id] : [])),
  );
  const rowGroups: RowGroup[] = !readDisplay
    ? baseGroups
    : baseGroups.flatMap((group): RowGroup[] => {
        const source = group.sourceCellId
          ? group.rows.flatMap((row) => coverage.get(row.id) ?? row.cells).find((c) => c?.id === group.sourceCellId)
          : undefined;
        if (!isIndentMarker(source) || !source) return [group];
        const titleCols = labelCols.filter((j) => j !== leftmost);
        return group.rows
          .filter((row) => hasInput(row) || (q.includeCalcOnlyLeaves === true && hasCalc(row)))
          .map((row) => {
            const title = rightmostLabel(row, titleCols, coverage, skipForTitle);
            return {
              label: title.label,
              rows: [row],
              ...(title.sourceCellId ? { sourceCellId: title.sourceCellId } : {}),
              identity: `row:${row.id}`,
              markerCellId: source.id,
            };
          });
      });
  const validHeadRowId = (group: RowGroup): string | undefined => {
    const headRowId = group.markerCellId ? headRowIdByMarker.get(group.markerCellId) : undefined;
    return headRowId && singleRowGroupRowIds.has(headRowId) ? headRowId : undefined;
  };
  const activeHeadRowIds = new Set(rowGroups.flatMap((g) => validHeadRowId(g) ?? []));

  return rowGroups.flatMap((sec): ClassifiedSection[] => {
    const soleRowId = sec.rows.length === 1 ? sec.rows[0]?.id : undefined;
    const isHead = soleRowId !== undefined && activeHeadRowIds.has(soleRowId);
    // 머리 후보인데 보이는 하위가 하나도 없으면 머리도 내보내지 않는다.
    if (
      soleRowId !== undefined &&
      !isHead &&
      !sec.markerCellId &&
      headCandidateRowIds.has(soleRowId) &&
      singleRowGroupRowIds.has(soleRowId)
    ) {
      return [];
    }
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
      subCol != null
        ? groupByColumn(sec.rows, subCol, coverage)
        : [{ label: '', rows: sec.rows }];
    const subOf = (row: TableRow) => subGroups.find((g) => g.rows.includes(row));

    // leaf 대상: 입력 행 + (opt-in 시) 계산 셀만 있는 행. 합계 표시 행은 입력은 없지만
    // 입력 드릴다운에 값이 보여야 한다. 입력도 계산도 없는 행은 라벨/구분 행으로만 쓰인다.
    const leafRows = sec.rows.filter(
      (row) => hasInput(row) || (q.includeCalcOnlyLeaves === true && hasCalc(row)),
    );

    const leaves: ClassifiedLeaf[] = leafRows.map((row) => {
      const subGroup = subOf(row);
      const leafLabel = rightmostLabel(row, labelCols, coverage, skipForTitle);
      const descriptionCellIds = readDisplay
        ? [
            ...new Set(
              (coverage.get(row.id) ?? row.cells).flatMap((c) =>
                c && isDescription(c) ? [c.id] : [],
              ),
            ),
          ]
        : [];
      const cellByCol: Record<number, string> = {};
      row.cells.forEach((cell, columnIndex) => {
        if (isInput(cell, types)) cellByCol[columnIndex] = cell.id;
      });
      return {
        rowId: row.id,
        label: leafLabel.label,
        ...(leafLabel.sourceCellId
          ? { labelSourceCellId: leafLabel.sourceCellId }
          : {}),
        subGroup: subGroup?.label ?? '',
        ...(subGroup?.sourceCellId ? { subGroupSourceCellId: subGroup.sourceCellId } : {}),
        inputCellIds: row.cells.filter((cell) => isInput(cell, types)).map((cell) => cell.id),
        calcCellIds: row.cells
          .filter((cell) => cell.type === 'calc' && !cell.isHidden && !cell._isContinuation)
          .map((cell) => cell.id),
        cellByCol,
        descriptionCellIds,
      };
    });

    const calcOnly = leaves.length > 0 && leaves.every((l) => l.inputCellIds.length === 0);
    const groupHeadRowId = isHead ? soleRowId : validHeadRowId(sec);
    return [
      {
        label: sec.label,
        ...(sec.sourceCellId ? { labelSourceCellId: sec.sourceCellId } : {}),
        kind,
        reason,
        leaves,
        colGroups,
        totalInputs: leaves.reduce((s, l) => s + l.inputCellIds.length, 0),
        role: isHead ? 'group-head' : readDisplay && calcOnly ? 'calc-summary' : 'default',
        ...(groupHeadRowId ? { groupHeadRowId } : {}),
        ...(sec.identity ? { identity: sec.identity } : {}),
      },
    ];
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
