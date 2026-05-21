/**
 * Cleaning Export 포매팅 & 데이터 빌딩
 *
 * 값 파싱/포매팅, 셀 분류, 체크박스 열 확장,
 * Semi-Long 데이터 행 생성 등 순수 데이터 변환 로직.
 * ExcelJS 의존 없음.
 */
import type {
  CheckboxOption,
  Question,
  QuestionGroup,
  QuestionOption,
  RadioOption,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';
import {
  shouldDisplayColumn,
  shouldDisplayQuestion,
  shouldDisplayRow,
} from '@/utils/branch-logic';
import { getOptionText } from '@/lib/option-text-read';

import { isCellInputable } from './excel-export-utils';
import type { ResponseData } from './response-data';

import type {
  ClassifiedCells,
  ExpandedColumn,
  OptionLike,
  SemiLongRow,
} from './cleaning-export-types';
import {
  LARGE_TABLE_ROW_THRESHOLD,
  NO_ANSWER_MARKER,
  SEMI_LONG_THRESHOLD_MEASUREMENT_COLS,
  SEMI_LONG_THRESHOLD_ROWS,
  UNEXPOSED_MARKER,
} from './cleaning-export-types';

/** id/value 기반 O(1) 옵션 검색용 Map 생성 */
function buildOptionMap(options: OptionLike[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const o of options) {
    map.set(o.id, o.label);
    map.set(o.value, o.label);
  }
  return map;
}

function resolveOptionLabel(optionMap: Map<string, string>, key: string): string {
  return optionMap.get(key) ?? key;
}

/** checkbox 응답 → { selectedIds, otherText } 파싱 */
export function parseCheckboxRawValue(rawValue: unknown): { selectedIds: string[]; otherText?: string } {
  if (Array.isArray(rawValue)) {
    return { selectedIds: rawValue as string[] };
  }
  if (typeof rawValue === 'object' && rawValue !== null) {
    const obj = rawValue as Record<string, unknown>;
    return {
      selectedIds: Array.isArray(obj.selectedValues) ? (obj.selectedValues as string[]) : [],
      otherText: obj.otherValue ? String(obj.otherValue) : undefined,
    };
  }
  return { selectedIds: [] };
}

/** radio/select 단일선택 응답 → { optionId, otherText } 파싱 */
function parseSingleChoiceRawValue(rawValue: unknown): { optionId: string; otherText?: string } {
  if (typeof rawValue === 'string') {
    return { optionId: rawValue };
  }
  if (typeof rawValue === 'object' && rawValue !== null) {
    const obj = rawValue as Record<string, unknown>;
    return {
      optionId: String(obj.selectedValue ?? obj.optionId ?? ''),
      otherText: obj.otherValue ? String(obj.otherValue) : undefined,
    };
  }
  return { optionId: String(rawValue) };
}

function formatCheckboxLabels(
  optionMap: Map<string, string>,
  rawValue: unknown,
): string | null {
  const { selectedIds, otherText } = parseCheckboxRawValue(rawValue);
  const labels = selectedIds.map((id) => resolveOptionLabel(optionMap, id)).filter(Boolean);
  if (otherText) labels.push(`기타: ${otherText}`);
  return labels.length > 0 ? labels.join(', ') : null;
}

function formatSingleChoiceLabel(
  optionMap: Map<string, string>,
  rawValue: unknown,
): string {
  const { optionId, otherText } = parseSingleChoiceRawValue(rawValue);
  const label = resolveOptionLabel(optionMap, optionId);
  return otherText ? `${label} (기타: ${otherText})` : label;
}

// ============================================================
// Cell/Question Value Formatting
// ============================================================

function formatCellValueForCleaning(
  cell: TableCell,
  rawValue: unknown,
): string | number | null {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;

  switch (cell.type) {
    case 'checkbox':
      return formatCheckboxLabels(
        buildOptionMap((cell.checkboxOptions ?? []) as OptionLike[]),
        rawValue,
      );

    case 'radio':
      return formatSingleChoiceLabel(
        buildOptionMap((cell.radioOptions ?? []) as OptionLike[]),
        rawValue,
      );

    case 'select':
      return formatSingleChoiceLabel(
        buildOptionMap((cell.selectOptions ?? []) as OptionLike[]),
        rawValue,
      );

    case 'input': {
      const val = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue);
      const num = Number(val);
      if (val !== '' && !isNaN(num)) return num;
      return val || null;
    }

    default:
      return String(rawValue);
  }
}

export function formatGeneralQuestionValue(
  question: Question,
  rawValue: unknown,
): string | number | null {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;

  switch (question.type) {
    case 'radio':
    case 'select':
      return formatSingleChoiceLabel(
        buildOptionMap((question.options ?? []) as OptionLike[]),
        rawValue,
      );

    case 'checkbox':
      return formatCheckboxLabels(
        buildOptionMap((question.options ?? []) as OptionLike[]),
        rawValue,
      );

    case 'multiselect': {
      if (!question.selectLevels) return String(rawValue);
      if (typeof rawValue === 'object' && rawValue !== null && !Array.isArray(rawValue)) {
        const obj = rawValue as Record<string, string>;
        return question.selectLevels
          .map((level) => {
            const val = obj[level.id];
            if (!val) return '';
            const map = buildOptionMap(level.options as OptionLike[]);
            return resolveOptionLabel(map, val);
          })
          .filter(Boolean)
          .join(' > ');
      }
      return String(rawValue);
    }

    case 'text':
    case 'textarea': {
      const val = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue);
      return val || null;
    }

    case 'notice': {
      if (typeof rawValue === 'object' && rawValue !== null) {
        return (rawValue as Record<string, unknown>).acknowledged ? '동의' : '미동의';
      }
      return String(rawValue);
    }

    default:
      return String(rawValue);
  }
}

// ============================================================
// Expanded Cell Value Formatting (checkbox split)
// ============================================================

/**
 * ExpandedColumn 기반으로 체크박스 셀의 개별 옵션 값을 생성한다.
 *
 * @param actualCell varying 옵션일 때 실제 행의 셀 (행마다 옵션이 다를 수 있음)
 */
export function formatExpandedCellValue(
  expandedCol: ExpandedColumn,
  rawValue: unknown,
  actualCell?: TableCell,
  qResponses?: Record<string, unknown>,
  questionId?: string,
): string | number | null {
  switch (expandedCol.columnKind) {
    case 'label':
      return null;

    case 'binary': {
      if (rawValue === undefined || rawValue === null || rawValue === '') return null;

      const optIdx = expandedCol.checkboxOptionIndex!;

      if (expandedCol.isVaryingOptions && actualCell) {
        const actualOpts = actualCell.checkboxOptions ?? [];
        if (optIdx >= actualOpts.length) return null;
        const actualOpt = actualOpts[optIdx];
        const { selectedIds } = parseCheckboxRawValue(rawValue);
        const isSelected = selectedIds.some((sid) => sid === actualOpt.value);
        return isSelected ? (actualOpt.spssNumericCode ?? (optIdx + 1)) : 0;
      }

      const { selectedIds } = parseCheckboxRawValue(rawValue);
      const isSelected = selectedIds.some((id) => id === expandedCol.optionValue);
      return isSelected ? (expandedCol.spssNumericCode ?? (optIdx + 1)) : 0;
    }

    case 'other-text': {
      if (rawValue === undefined || rawValue === null || rawValue === '') return null;

      // allowTextInput 옵션 텍스트: __optTexts__ 사이드카에서 선택된 옵션들의 텍스트를 읽는다.
      // cellId 는 일반 질문의 경우 question.id, 테이블 셀의 경우 cell.id 이다.
      // questionId 파라미터가 전달된 경우 이를 우선 사용하고, 없으면 cellId 로 폴백한다.
      const resolvedQuestionId = questionId ?? expandedCol.cellId;
      if (resolvedQuestionId && qResponses) {
        const cellForOpts = actualCell ?? expandedCol.cell;
        const allowTextInputOpts = (cellForOpts.checkboxOptions ?? []).filter(
          (o: CheckboxOption) => o.allowTextInput,
        );
        if (allowTextInputOpts.length > 0) {
          const { selectedIds } = parseCheckboxRawValue(rawValue);
          const selectedSet = new Set(selectedIds);
          const texts: string[] = [];
          for (const opt of allowTextInputOpts) {
            // optionId 가 selectedIds 에 포함된 경우에만 텍스트를 읽는다.
            if (!selectedSet.has(opt.id) && !selectedSet.has(opt.value)) continue;
            const text = getOptionText(qResponses, resolvedQuestionId, opt.id);
            if (text) texts.push(text);
          }
          if (texts.length > 0) return texts.join(', ');
        }
      }

      // 레거시 fallback: otherValue 기반 기타 응답 (9 OtherChoiceValue 호환)
      const { otherText } = parseCheckboxRawValue(rawValue);
      return otherText ?? null;
    }

    case 'value':
      return formatCellValueForCleaning(expandedCol.cell, rawValue);
  }
}

// ============================================================
// Small Helpers
// ============================================================

export function isNonDataDepth1(value: string): boolean {
  return value === '-' || value === NO_ANSWER_MARKER;
}

/** 측정 셀의 h2 헤더 라벨 생성 (옵션 목록 표시) */
function getMeasurementH2Label(cell: TableCell, fallbackLabel: string): string {
  if (cell.type === 'checkbox' && cell.checkboxOptions?.length) {
    return cell.checkboxOptions.map((o: CheckboxOption) => o.label).join(' | ');
  }
  if (cell.type === 'radio' && cell.radioOptions?.length) {
    return cell.radioOptions.map((o: RadioOption) => o.label).join(' | ');
  }
  if (cell.type === 'select' && cell.selectOptions?.length) {
    return cell.selectOptions.map((o: QuestionOption) => o.label).join(' | ');
  }
  return fallbackLabel;
}

function hasNonMetaKeys(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((key) => !key.startsWith('__'));
}

// ============================================================
// Cell Classification
// ============================================================

export function classifyTableCells(
  rows: TableRow[],
  columns: TableColumn[],
): ClassifiedCells {
  if (!rows.length || !rows[0].cells.length) {
    return { identifiers: [], measurements: [] };
  }

  const firstRow = rows[0];
  const identifiers: ClassifiedCells['identifiers'] = [];
  const measurements: ClassifiedCells['measurements'] = [];
  let passedIdentifiers = false;

  for (let i = 0; i < firstRow.cells.length; i++) {
    const cell = firstRow.cells[i];
    if (cell.isHidden || cell._isContinuation) continue;

    // radio/select는 input/checkbox 앞에 오면 식별자(depth-2+)로 분류
    const isDataInputCell = cell.type === 'input' || cell.type === 'checkbox';
    if (!passedIdentifiers && !isDataInputCell) {
      identifiers.push({
        colIndex: i,
        cell,
        label: columns[i]?.label || `식별자${identifiers.length + 1}`,
      });
    } else {
      passedIdentifiers = true;
      if (isCellInputable(cell)) {
        measurements.push({
          colIndex: i,
          cell,
          label: columns[i]?.label || `측정${measurements.length + 1}`,
        });
      }
    }
  }

  return { identifiers, measurements };
}

// ============================================================
// Checkbox Column Expansion
// ============================================================

/**
 * 행마다 체크박스 옵션이 다른지 검사한다.
 */
export function hasVaryingCheckboxOptions(
  rows: TableRow[],
  measurements: ClassifiedCells['measurements'],
): boolean {
  if (rows.length <= 1) return false;

  for (const m of measurements) {
    const firstCell = rows[0]?.cells[m.colIndex];
    if (!firstCell || firstCell.type !== 'checkbox' || !firstCell.checkboxOptions?.length) continue;

    const firstValues = firstCell.checkboxOptions.map((o) => o.value);

    for (let ri = 1; ri < rows.length; ri++) {
      const cell = rows[ri]?.cells[m.colIndex];
      if (!cell || cell.type !== 'checkbox') continue;
      const opts = cell.checkboxOptions ?? [];
      if (opts.length !== firstValues.length) return true;
      for (let oi = 0; oi < opts.length; oi++) {
        if (opts[oi].value !== firstValues[oi]) return true;
      }
    }
  }

  return false;
}

export function expandMeasurements(
  measurements: ClassifiedCells['measurements'],
  columns: TableColumn[],
  allRows?: TableRow[],
): ExpandedColumn[] {
  const result: ExpandedColumn[] = [];
  const varying = allRows ? hasVaryingCheckboxOptions(allRows, measurements) : false;

  let skipLeadingSelectors = varying;

  for (const m of measurements) {
    const { cell, colIndex, label } = m;

    if (skipLeadingSelectors) {
      if (cell.type === 'radio' || cell.type === 'select') continue;
      skipLeadingSelectors = false;
    }
    const colLabel = columns[colIndex]?.label ?? label;

    if (cell.type === 'checkbox' && cell.checkboxOptions && cell.checkboxOptions.length > 0) {
      const cellCode = cell.cellCode ?? `c${colIndex}`;

      let maxOptCount = cell.checkboxOptions.length;
      let anyHasTextInput = cell.checkboxOptions.some((o: CheckboxOption) => o.allowTextInput);

      if (varying && allRows) {
        for (const row of allRows) {
          const rowCell = row.cells[colIndex];
          if (rowCell?.type === 'checkbox' && rowCell.checkboxOptions) {
            maxOptCount = Math.max(maxOptCount, rowCell.checkboxOptions.length);
            if (rowCell.checkboxOptions.some((o: CheckboxOption) => o.allowTextInput)) anyHasTextInput = true;
          }
        }
      }

      const opts = cell.checkboxOptions;

      // 1) 보이는 라벨 합산 열
      result.push({
        cell,
        colIndex,
        columnKind: 'label',
        checkboxOptionIndex: null,
        h1Label: colLabel,
        h2Label: varying
          ? `옵션1~${maxOptCount}`
          : opts.map((o: CheckboxOption) => o.label).join(' | '),
        h3Label: cellCode,
        cellId: cell.id,
        visible: true,
        isVaryingOptions: varying,
      });

      // 2) 숨김 binary 열
      for (let i = 0; i < maxOptCount; i++) {
        const opt = i < opts.length ? opts[i] : null;
        result.push({
          cell,
          colIndex,
          columnKind: 'binary',
          checkboxOptionIndex: i,
          optionValue: opt?.value,
          spssNumericCode: varying ? (i + 1) : (opt?.spssNumericCode ?? (i + 1)),
          optionLabel: varying ? `옵션${i + 1}` : (opt?.label ?? `옵션${i + 1}`),
          h1Label: colLabel,
          h2Label: varying ? `옵션${i + 1}` : (opt?.label ?? `옵션${i + 1}`),
          h3Label: `${cellCode}_${varying ? String(i + 1) : (opt?.optionCode ?? String(i + 1))}`,
          cellId: cell.id,
          visible: false,
          isVaryingOptions: varying,
        });
      }

      // 3) 숨김 텍스트 입력 열 (allowTextInput 옵션이 있는 경우)
      if (anyHasTextInput) {
        result.push({
          cell,
          colIndex,
          columnKind: 'other-text',
          checkboxOptionIndex: null,
          h1Label: colLabel,
          h2Label: '텍스트 입력',
          h3Label: `${cellCode}_text`,
          cellId: cell.id,
          visible: false,
          isVaryingOptions: varying,
        });
      }
    } else {
      result.push({
        cell,
        colIndex,
        columnKind: 'value',
        checkboxOptionIndex: null,
        h1Label: colLabel,
        h2Label: getMeasurementH2Label(cell, colLabel),
        h3Label: cell.cellCode ?? `c${colIndex}`,
        cellId: cell.id,
        visible: true,
      });
    }
  }

  return result;
}

/** 일반문항 checkbox 질문을 ExpandedColumn 유사 구조로 확장 */
export function expandGeneralCheckboxQuestion(
  question: Question,
): { label: ExpandedColumn; binaries: ExpandedColumn[]; otherText?: ExpandedColumn } | null {
  if (question.type !== 'checkbox' || !question.options || question.options.length === 0) {
    return null;
  }

  const opts = question.options;
  const qCode = question.questionCode ?? question.id;
  // checkboxOptions 에 question.options 를 주입해두어야 formatExpandedCellValue 에서
  // allowTextInput 옵션 텍스트를 읽을 때 올바른 옵션 목록을 참조할 수 있다.
  const dummyCell = {
    id: question.id,
    type: 'checkbox' as const,
    content: '',
    checkboxOptions: opts as unknown as CheckboxOption[],
  };

  const label: ExpandedColumn = {
    cell: dummyCell as TableCell,
    colIndex: -1,
    columnKind: 'label',
    checkboxOptionIndex: null,
    h1Label: question.title,
    h2Label: opts.map((o) => o.label).join(' | '),
    h3Label: qCode,
    cellId: question.id,
    visible: true,
  };

  const binaries: ExpandedColumn[] = opts.map((opt, i) => ({
    cell: dummyCell as TableCell,
    colIndex: -1,
    columnKind: 'binary' as const,
    checkboxOptionIndex: i,
    optionValue: opt.value,
    spssNumericCode: Number(opt.spssNumericCode) || (i + 1),
    optionLabel: opt.label,
    h1Label: question.title,
    h2Label: opt.label,
    h3Label: `${qCode}_${opt.optionCode ?? String(i + 1)}`,
    cellId: question.id,
    visible: false,
  }));

  const hasTextInput = opts.some((o) => o.allowTextInput);
  const otherText: ExpandedColumn | undefined = hasTextInput
    ? {
        cell: dummyCell as TableCell,
        colIndex: -1,
        columnKind: 'other-text',
        checkboxOptionIndex: null,
        h1Label: question.title,
        h2Label: '텍스트 입력',
        h3Label: `${qCode}_text`,
        cellId: question.id,
        visible: false,
      }
    : undefined;

  return { label, binaries, otherText };
}

export function shouldUseSemiLong(
  rows: TableRow[],
  measurements: ClassifiedCells['measurements'],
  identifiers: ClassifiedCells['identifiers'],
): boolean {
  if (hasVaryingCheckboxOptions(rows, measurements)) return true;
  if (identifiers.length === 0) return false;
  if (measurements.length > SEMI_LONG_THRESHOLD_MEASUREMENT_COLS) return true;
  if (rows.length > SEMI_LONG_THRESHOLD_ROWS) return true;
  return false;
}

// ============================================================
// Semi-Long Data Building
// ============================================================

/** 식별자 셀의 표시 라벨을 추출 — radio/select는 옵션 라벨 사용 */
function getIdentifierCellLabel(cell: TableCell): string {
  if (cell.type === 'radio' && cell.radioOptions?.length) {
    return cell.radioOptions.map((o) => o.label).join(', ');
  }
  if (cell.type === 'select' && cell.selectOptions?.length) {
    return cell.selectOptions.map((o) => o.label).join(', ');
  }
  return cell.content || '';
}

function extractIdentifierValues(
  rows: TableRow[],
  rowIndex: number,
  identifierColIndices: number[],
  rowspanTracker: Map<number, { value: string; remaining: number }>,
): string[] {
  const row = rows[rowIndex];
  const values: string[] = [];

  for (const colIdx of identifierColIndices) {
    const tracker = rowspanTracker.get(colIdx);
    if (tracker && tracker.remaining > 0) {
      values.push(tracker.value);
      tracker.remaining--;
      continue;
    }

    const cell = row.cells[colIdx];
    if (!cell || cell.isHidden || cell._isContinuation) {
      values.push('');
      continue;
    }

    const value = getIdentifierCellLabel(cell);
    values.push(value);

    if (cell.rowspan && cell.rowspan > 1) {
      rowspanTracker.set(colIdx, { value, remaining: cell.rowspan - 1 });
    }
  }

  return values;
}

function getVisibleRows(
  rows: TableRow[],
  tableResponse: Record<string, unknown>,
  dynamicRowConfigs?: { groupId: string; enabled: boolean }[],
): TableRow[] {
  if (!dynamicRowConfigs?.length) return rows;

  const enabledGroupIds = new Set(
    dynamicRowConfigs.filter((g) => g.enabled).map((g) => g.groupId),
  );
  const selectedRowIds = new Set(
    (tableResponse.__selectedRowIds as string[] | undefined) ?? [],
  );

  return rows.filter((row) => {
    if (!row.dynamicGroupId) return true;
    if (!enabledGroupIds.has(row.dynamicGroupId)) return false;
    return selectedRowIds.has(row.id);
  });
}

export function buildSemiLongRows(
  question: Question,
  responses: ResponseData[],
  classified: ClassifiedCells,
  expandedColumns: ExpandedColumn[],
  allQuestions: Question[],
  allGroups?: QuestionGroup[],
): SemiLongRow[] {
  const allRows = question.tableRowsData ?? [];
  const columns = question.tableColumns ?? [];
  const result: SemiLongRow[] = [];

  const identifierColIndices = classified.identifiers.map((id) => id.colIndex);
  const uniqueMeasurementColIndices = [...new Set(expandedColumns.map((ec) => ec.colIndex))];
  const hasVirtual = classified.identifiers.length === 0;

  function buildCellIdKey(ec: ExpandedColumn, cellId: string): string {
    if (ec.columnKind === 'binary') {
      return ec.isVaryingOptions
        ? `${cellId}:optIdx_${ec.checkboxOptionIndex}`
        : `${cellId}:${ec.optionValue}`;
    }
    if (ec.columnKind === 'other-text') return `${cellId}:etc`;
    return cellId;
  }

  for (const resp of responses) {
    const allResponses = resp.questionResponses;
    const tableResponse = (allResponses[question.id] ?? {}) as Record<string, unknown>;

    if (!shouldDisplayQuestion(question, allResponses, allQuestions, allGroups)) {
      result.push({
        responseId: resp.id,
        seqNum: 0,
        rowLabel: '',
        identifierValues: hasVirtual ? [] : classified.identifiers.map(() => ''),
        measurementValues: expandedColumns.map(() => UNEXPOSED_MARKER),
        depth1Value: '',
        questionId: question.id,
        rowIndex: -1,
        cellIds: expandedColumns.map((ec) => buildCellIdKey(ec, allRows[0]?.cells[ec.colIndex]?.id ?? '')),
        isUnexposed: 'question',
        unexposedColumns: new Set(),
      });
      continue;
    }

    const rows = getVisibleRows(allRows, tableResponse, question.dynamicRowConfigs);

    const unexposedOrigColIndices = new Set<number>();
    for (const ci of uniqueMeasurementColIndices) {
      const column = columns[ci];
      if (column && !shouldDisplayColumn(column, allResponses, allQuestions)) {
        unexposedOrigColIndices.add(ci);
      }
    }
    const unexposedExpandedIndices = new Set<number>();
    for (let ei = 0; ei < expandedColumns.length; ei++) {
      if (unexposedOrigColIndices.has(expandedColumns[ei].colIndex)) {
        unexposedExpandedIndices.add(ei);
      }
    }

    if (!hasNonMetaKeys(tableResponse) && allRows.length > LARGE_TABLE_ROW_THRESHOLD) {
      result.push({
        responseId: resp.id,
        seqNum: 0,
        rowLabel: NO_ANSWER_MARKER,
        identifierValues: hasVirtual ? [] : [NO_ANSWER_MARKER, ...classified.identifiers.slice(1).map(() => '')],
        measurementValues: expandedColumns.map(() => null),
        depth1Value: NO_ANSWER_MARKER,
        questionId: question.id,
        rowIndex: -1,
        cellIds: expandedColumns.map((ec) => buildCellIdKey(ec, allRows[0]?.cells[ec.colIndex]?.id ?? '')),
        isUnexposed: false,
        unexposedColumns: new Set(),
      });
      continue;
    }

    const rowspanTracker = new Map<number, { value: string; remaining: number }>();
    const visibleRowSet = new Set(rows);
    let seqNum = 0;
    let prevDepth1 = '';

    for (let origRi = 0; origRi < allRows.length; origRi++) {
      const row = allRows[origRi];
      const identifierValues = hasVirtual
        ? []
        : extractIdentifierValues(allRows, origRi, identifierColIndices, rowspanTracker);
      if (!visibleRowSet.has(row)) continue;

      const originalRowIndex = origRi;
      const isRowExposed = shouldDisplayRow(row, allResponses, allQuestions);
      const depth1Value = hasVirtual ? (row.label || '') : (identifierValues[0] || '');

      if (depth1Value !== prevDepth1) {
        seqNum = 0;
        prevDepth1 = depth1Value;
      }
      seqNum++;

      const currentRowLabel = row.label || `행${originalRowIndex + 1}`;

      if (!isRowExposed) {
        result.push({
          responseId: resp.id,
          seqNum,
          rowLabel: currentRowLabel,
          identifierValues,
          measurementValues: expandedColumns.map(() => UNEXPOSED_MARKER),
          depth1Value,
          questionId: question.id,
          rowIndex: originalRowIndex,
          cellIds: expandedColumns.map((ec) => buildCellIdKey(ec, row.cells[ec.colIndex]?.id ?? '')),
          isUnexposed: 'row',
          unexposedColumns: new Set(),
        });
        continue;
      }

      const measurementValues: (string | number | null)[] = [];
      const cellIds: string[] = [];
      const computedLabels = new Map<number, string>();

      for (let ei = 0; ei < expandedColumns.length; ei++) {
        const ec = expandedColumns[ei];
        const actualCell = row.cells[ec.colIndex];
        cellIds.push(buildCellIdKey(ec, actualCell?.id ?? ''));

        if (unexposedExpandedIndices.has(ei)) {
          measurementValues.push(UNEXPOSED_MARKER);
        } else if (!actualCell) {
          measurementValues.push(null);
        } else {
          const rawVal = tableResponse[actualCell.id];
          measurementValues.push(formatExpandedCellValue(ec, rawVal, actualCell, allResponses, question.id));

          if (ec.columnKind === 'label' && ec.isVaryingOptions) {
            if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
              const { selectedIds, otherText } = parseCheckboxRawValue(rawVal);
              const opts = actualCell.checkboxOptions ?? [];
              const labels = opts
                .filter((o) => selectedIds.includes(o.value))
                .map((o) => o.label);
              if (otherText) labels.push(`기타: ${otherText}`);
              computedLabels.set(ei, labels.join(', '));
            }
          }
        }
      }

      result.push({
        responseId: resp.id,
        seqNum,
        rowLabel: currentRowLabel,
        identifierValues,
        measurementValues,
        depth1Value,
        questionId: question.id,
        rowIndex: originalRowIndex,
        cellIds,
        isUnexposed: false,
        unexposedColumns: unexposedExpandedIndices,
        computedLabels: computedLabels.size > 0 ? computedLabels : undefined,
      });
    }
  }

  return result;
}

// ============================================================
// Semi-Long Header Building
// ============================================================

/** Semi-Long 시트의 3행 헤더를 생성한다. (ExpandedColumn 기반) */
export function buildSemiLongHeaders(
  classified: ClassifiedCells,
  expandedColumns: ExpandedColumn[],
): { h1: string[]; h2: string[]; h3: string[] } {
  const metaCols = ['response_id', '행 라벨'];
  const hasVirtualId = classified.identifiers.length === 0;
  const idLabels = hasVirtualId ? [] : classified.identifiers.map((id) => id.label);

  const h1 = [...metaCols, ...idLabels, ...expandedColumns.map((ec) => ec.h1Label)];
  const h2 = [...metaCols, ...idLabels, ...expandedColumns.map((ec) => ec.h2Label)];
  const h3 = [
    ...metaCols,
    ...classified.identifiers.map((_, i) => `id_${i + 1}`),
    ...expandedColumns.map((ec) => ec.h3Label),
  ];

  return { h1, h2, h3 };
}
