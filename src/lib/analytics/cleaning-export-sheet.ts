/**
 * Cleaning Export Sheet Builders
 *
 * 4종의 개별 시트 생성기:
 * - buildIndexSheet: 응답자 메타(응답자목록) 시트
 * - buildGeneralQuestionsSheet: 일반 질문(테이블 외) 시트
 * - buildWideTableSheet: 테이블 질문의 Wide 형식 시트
 * - buildSemiLongSheet: 테이블 질문의 Semi-Long 형식 시트 (identifier는 행, measurement는 열)
 *
 * 저수준 Excel 유틸은 `cleaning-export-primitives`, 데이터 렌더링 로직은
 * `cleaning-export-renderers`에 위임한다 — 이 파일은 오케스트레이션 역할만.
 */
import ExcelJS from 'exceljs';

import { formatKstDateTimeForExport } from '@/lib/date-formatters';
import type {
  CheckboxOption,
  Question,
  QuestionGroup,
  TableCell,
} from '@/types/survey';
import {
  shouldDisplayColumn,
  shouldDisplayQuestion,
  shouldDisplayRow,
} from '@/utils/branch-logic';

import { isCellInputable } from './excel-export-utils';
import type { ResponseData } from './response-data';

import type {
  ClassifiedCells,
  DataRowMeta,
  ExpandedColumn,
  SemiLongRow,
} from './cleaning-export-types';
import {
  HEADER_ROW_COUNT,
  TAB_COLOR_SEMI_LONG,
  TAB_COLOR_WIDE,
  TITLE_ROW_OFFSET,
  UNEXPOSED_FONT,
  UNEXPOSED_MARKER,
} from './cleaning-export-types';

import {
  buildSemiLongHeaders,
  expandGeneralCheckboxQuestion,
  formatExpandedCellValue,
  formatGeneralQuestionValue,
} from './cleaning-export-format';

import {
  addRow,
  applyAutoFilterAndFreeze,
  applyHeaderStyle,
  autoFitColumnWidths,
  mergeHeaderCells,
  sanitizeSheetName,
  setCellValue,
  setCellValueChunked,
  setupHiddenColumns,
} from './cleaning-export-primitives';

import {
  applyCheckboxFormulas,
  applyEmptyRowGrouping,
  applyHiddenAndValidation,
  mergeExpandedH1Headers,
  writeSemiLongDataRows,
} from './cleaning-export-renderers';

// ============================================================
// Sheet Generators
// ============================================================

export function buildIndexSheet(
  workbook: ExcelJS.Workbook,
  responses: ResponseData[],
  sheetNames: Set<string>,
): void {
  const name = sanitizeSheetName('응답자목록', sheetNames);
  const ws = workbook.addWorksheet(name, { properties: { tabColor: TAB_COLOR_WIDE } });

  const h1 = ['response_id', '시작 시간', '완료 시간', '소요 시간(초)', '상태', 'User Agent'];
  const h2 = ['response_id', 'datetime', 'datetime', 'number(초)', 'enum', 'string'];
  const h3 = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
  addRow(ws, h1);
  addRow(ws, h2);
  addRow(ws, h3);
  applyHeaderStyle(ws, h1.length);
  mergeHeaderCells(ws, 1);

  for (const resp of responses) {
    const startedAt = resp.startedAt ? new Date(resp.startedAt) : null;
    const completedAt = resp.completedAt ? new Date(resp.completedAt) : null;
    const durationSec =
      startedAt && completedAt
        ? Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)
        : '';

    addRow(ws, [
      resp.id,
      startedAt ? formatKstDateTimeForExport(startedAt) : '',
      completedAt ? formatKstDateTimeForExport(completedAt) : '',
      durationSec,
      resp.isCompleted ? '완료' : '미완료',
      resp.userAgent ?? '',
    ]);
  }

  applyAutoFilterAndFreeze(ws, h1.length, 1);
  autoFitColumnWidths(ws);
}

export function buildGeneralQuestionsSheet(
  workbook: ExcelJS.Workbook,
  survey: { questions: Question[]; groups?: QuestionGroup[] },
  responses: ResponseData[],
  sheetNames: Set<string>,
): void {
  const generalQuestions = survey.questions
    .filter((q) => q.type !== 'table' && !(q.type === 'notice' && !q.requiresAcknowledgment))
    .sort((a, b) => a.order - b.order);

  if (generalQuestions.length === 0) return;

  const name = sanitizeSheetName('일반문항', sheetNames);
  const ws = workbook.addWorksheet(name, { properties: { tabColor: TAB_COLOR_WIDE } });

  interface GeneralCol {
    question: Question;
    expanded: ExpandedColumn | null;
  }

  const generalCols: GeneralCol[] = [];
  for (const q of generalQuestions) {
    const cbExpanded = expandGeneralCheckboxQuestion(q);
    if (cbExpanded) {
      generalCols.push({ question: q, expanded: cbExpanded.label });
      for (const bin of cbExpanded.binaries) {
        generalCols.push({ question: q, expanded: bin });
      }
      if (cbExpanded.otherText) {
        generalCols.push({ question: q, expanded: cbExpanded.otherText });
      }
    } else {
      generalCols.push({ question: q, expanded: null });
    }
  }

  const h1 = ['response_id', ...generalCols.map((gc) => gc.expanded?.h1Label ?? gc.question.title)];
  const h2 = ['response_id', ...generalCols.map((gc) => gc.expanded?.h2Label ?? gc.question.type)];
  const h3 = ['response_id', ...generalCols.map((gc) => gc.expanded?.h3Label ?? (gc.question.questionCode ?? gc.question.id))];
  addRow(ws, h1);
  addRow(ws, h2);
  addRow(ws, h3);
  applyHeaderStyle(ws, h1.length);
  mergeHeaderCells(ws, 1);

  const allQuestions = survey.questions;
  const allGroups = survey.groups;

  const dataRowMetas: DataRowMeta[] = [];

  for (const resp of responses) {
    const allResponses = resp.questionResponses;
    const row: (string | number | null)[] = [resp.id];

    for (const gc of generalCols) {
      const q = gc.question;
      if (!shouldDisplayQuestion(q, allResponses, allQuestions, allGroups)) {
        row.push(UNEXPOSED_MARKER);
      } else if (gc.expanded) {
        row.push(formatExpandedCellValue(gc.expanded, allResponses[q.id]));
      } else {
        row.push(formatGeneralQuestionValue(q, allResponses[q.id]));
      }
    }

    const excelRow = addRow(ws, row);
    for (let c = 1; c < row.length; c++) {
      if (row[c] === UNEXPOSED_MARKER) {
        excelRow.getCell(c + 1).font = UNEXPOSED_FONT;
      }
    }

    dataRowMetas.push({ isUnexposed: false, depth1Value: '' });
  }

  // 체크박스 수식/숨김/드롭다운 적용
  const hasCheckbox = generalCols.some((gc) => gc.expanded);
  if (hasCheckbox) {
    const allExpanded: ExpandedColumn[] = generalCols.map((gc) => {
      if (gc.expanded) return gc.expanded;
      return {
        cell: { id: gc.question.id, type: 'text' as const, content: '' } as TableCell,
        colIndex: -1, columnKind: 'value' as const, checkboxOptionIndex: null,
        h1Label: gc.question.title, h2Label: gc.question.type,
        h3Label: gc.question.questionCode ?? gc.question.id,
        cellId: gc.question.id, visible: true,
      };
    });

    const measureStartCol = 2;
    applyCheckboxFormulas(ws, allExpanded, measureStartCol, dataRowMetas);
    applyHiddenAndValidation(ws, allExpanded, measureStartCol, responses.length);

    // h1 병합: 같은 질문의 연속 열
    let mergeStart = measureStartCol;
    let prevQId: string | null | undefined = generalCols[0]?.question.id;
    for (let i = 1; i <= generalCols.length; i++) {
      const currQId = i < generalCols.length ? generalCols[i].question.id : null;
      if (currQId !== prevQId) {
        const mergeEnd = measureStartCol + i - 1;
        if (mergeEnd > mergeStart) {
          ws.mergeCells(1, mergeStart, 1, mergeEnd);
          ws.getRow(1).getCell(mergeStart).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        }
        mergeStart = measureStartCol + i;
        prevQId = currQId;
      }
    }
  }

  applyAutoFilterAndFreeze(ws, h1.length, 1);
  autoFitColumnWidths(ws);
}

export function buildWideTableSheet(
  workbook: ExcelJS.Workbook,
  question: Question,
  responses: ResponseData[],
  allQuestions: Question[],
  sheetNames: Set<string>,
  allGroups?: QuestionGroup[],
): void {
  const rows = question.tableRowsData ?? [];
  const columns = question.tableColumns ?? [];

  const sheetLabel = question.questionCode ?? question.title.slice(0, 30);
  const name = sanitizeSheetName(sheetLabel, sheetNames);
  const ws = workbook.addWorksheet(name, { properties: { tabColor: TAB_COLOR_WIDE } });

  interface WideExpandedCol {
    rowIdx: number;
    colIdx: number;
    cell: TableCell;
    rowLabel: string;
    expanded: ExpandedColumn;
  }

  const wideCols: WideExpandedCol[] = [];
  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < rows[ri].cells.length; ci++) {
      const cell = rows[ri].cells[ci];
      if (cell.isHidden || cell._isContinuation) continue;
      if (!isCellInputable(cell)) continue;

      const rowLabel = rows[ri].label || `행${ri + 1}`;
      const colLabel = columns[ci]?.label ?? '';
      const cellCode = cell.cellCode ?? `r${ri}_c${ci}`;

      if (cell.type === 'checkbox' && cell.checkboxOptions && cell.checkboxOptions.length > 0) {
        const opts = cell.checkboxOptions;
        wideCols.push({
          rowIdx: ri, colIdx: ci, cell, rowLabel,
          expanded: {
            cell, colIndex: ci, columnKind: 'label', checkboxOptionIndex: null,
            h1Label: rowLabel, h2Label: opts.map((o: CheckboxOption) => o.label).join(' | '),
            h3Label: cellCode, cellId: cell.id, visible: true,
          },
        });
        for (let oi = 0; oi < opts.length; oi++) {
          const opt = opts[oi];
          wideCols.push({
            rowIdx: ri, colIdx: ci, cell, rowLabel,
            expanded: {
              cell, colIndex: ci, columnKind: 'binary', checkboxOptionIndex: oi,
              optionValue: opt.value,
              spssNumericCode: opt.spssNumericCode ?? (oi + 1),
              optionLabel: opt.label,
              h1Label: rowLabel, h2Label: opt.label,
              h3Label: `${cellCode}_${opt.optionCode ?? String(oi + 1)}`,
              cellId: cell.id, visible: false,
            },
          });
        }
        if (opts.some((o: CheckboxOption) => o.hasOther)) {
          wideCols.push({
            rowIdx: ri, colIdx: ci, cell, rowLabel,
            expanded: {
              cell, colIndex: ci, columnKind: 'other-text', checkboxOptionIndex: null,
              h1Label: rowLabel, h2Label: '기타 입력',
              h3Label: `${cellCode}_etc`, cellId: cell.id, visible: false,
            },
          });
        }
      } else {
        wideCols.push({
          rowIdx: ri, colIdx: ci, cell, rowLabel,
          expanded: {
            cell, colIndex: ci, columnKind: 'value', checkboxOptionIndex: null,
            h1Label: rowLabel, h2Label: colLabel,
            h3Label: cellCode, cellId: cell.id, visible: true,
          },
        });
      }
    }
  }

  const expandedList = wideCols.map((wc) => wc.expanded);

  const ro = TITLE_ROW_OFFSET;

  const titleRow = ws.addRow([question.title]);
  titleRow.font = { bold: true, size: 11 };
  titleRow.height = 28;

  const h1 = ['response_id', ...expandedList.map((ec) => ec.h1Label)];
  const h2 = ['response_id', ...expandedList.map((ec) => ec.h2Label)];
  const h3 = ['response_id', ...expandedList.map((ec) => ec.h3Label)];
  addRow(ws, h1);
  addRow(ws, h2);
  addRow(ws, h3);
  applyHeaderStyle(ws, h1.length, ro);
  mergeHeaderCells(ws, 1, ro);

  ws.mergeCells(1, 1, 1, h1.length);

  const hiddenStartCol = h1.length + 1;
  setupHiddenColumns(ws, hiddenStartCol, 3, ro);

  const dataRowMetas: DataRowMeta[] = [];

  for (const resp of responses) {
    const allResponses = resp.questionResponses;
    const tableResponse = (allResponses[question.id] ?? {}) as Record<string, unknown>;
    const isExposed = shouldDisplayQuestion(question, allResponses, allQuestions, allGroups);

    const unexposedRowIndices = new Set<number>();
    const unexposedColIndices = new Set<number>();
    if (isExposed) {
      for (let ri = 0; ri < rows.length; ri++) {
        if (!shouldDisplayRow(rows[ri], allResponses, allQuestions)) unexposedRowIndices.add(ri);
      }
      for (let ci = 0; ci < columns.length; ci++) {
        if (!shouldDisplayColumn(columns[ci], allResponses, allQuestions)) unexposedColIndices.add(ci);
      }
    }

    const dataRow: (string | number | null)[] = [resp.id];
    const cellIdsRow: string[] = [];

    for (const wc of wideCols) {
      const ec = wc.expanded;
      const isUnexposed = !isExposed || unexposedRowIndices.has(wc.rowIdx) || unexposedColIndices.has(wc.colIdx);

      if (ec.columnKind === 'binary') {
        cellIdsRow.push(`${wc.cell.id}:${ec.optionValue}`);
      } else if (ec.columnKind === 'other-text') {
        cellIdsRow.push(`${wc.cell.id}:etc`);
      } else {
        cellIdsRow.push(wc.cell.id);
      }

      if (isUnexposed) {
        dataRow.push(UNEXPOSED_MARKER);
      } else {
        dataRow.push(formatExpandedCellValue(ec, tableResponse[wc.cell.id]));
      }
    }

    const excelRow = addRow(ws, dataRow);
    setCellValueChunked(excelRow, hiddenStartCol, cellIdsRow.join(','));
    setCellValue(excelRow.getCell(hiddenStartCol + 2), question.id);

    for (let c = 1; c < dataRow.length; c++) {
      if (dataRow[c] === UNEXPOSED_MARKER) excelRow.getCell(c + 1).font = UNEXPOSED_FONT;
    }

    dataRowMetas.push({ isUnexposed: false, depth1Value: '' });
  }

  const measureStartCol = 2;
  applyCheckboxFormulas(ws, expandedList, measureStartCol, dataRowMetas, ro);
  applyHiddenAndValidation(ws, expandedList, measureStartCol, responses.length, ro);
  mergeExpandedH1Headers(ws, expandedList, measureStartCol, ro);

  applyAutoFilterAndFreeze(ws, h1.length, 1, ro);
  autoFitColumnWidths(ws);
}

export function buildSemiLongSheet(
  workbook: ExcelJS.Workbook,
  question: Question,
  classified: ClassifiedCells,
  expandedColumns: ExpandedColumn[],
  dataRows: SemiLongRow[],
  sheetNames: Set<string>,
  sheetNameOverride?: string,
  options?: { tabColor?: { argb: string }; titleSuffix?: string },
): void {
  const sheetLabel = sheetNameOverride
    ?? (question.questionCode ?? question.title.slice(0, 30));
  const name = sanitizeSheetName(sheetLabel, sheetNames);
  const tabColor = options?.tabColor ?? TAB_COLOR_SEMI_LONG;
  const ws = workbook.addWorksheet(name, { properties: { tabColor } });
  const ro = TITLE_ROW_OFFSET;

  const titleText = options?.titleSuffix
    ? `${question.title} — ${options.titleSuffix}`
    : question.title;
  const titleRow = ws.addRow([titleText]);
  titleRow.font = { bold: true, size: 11 };
  titleRow.height = 28;

  const { h1, h2, h3 } = buildSemiLongHeaders(classified, expandedColumns);
  addRow(ws, h1);
  addRow(ws, h2);
  addRow(ws, h3);
  applyHeaderStyle(ws, h1.length, ro);
  mergeHeaderCells(ws, 1, ro);
  mergeHeaderCells(ws, 2, ro);

  const idColCount = classified.identifiers.length;

  const hiddenStartCol = h1.length + 1;
  setupHiddenColumns(ws, hiddenStartCol, 4, ro);

  const metaColCount = 2;
  const measureStartCol = metaColCount + idColCount + 1;

  writeSemiLongDataRows(ws, dataRows, h1.length, metaColCount, idColCount, hiddenStartCol, ro);

  // Semi-Long용 DataRowMeta 변환
  const dataRowMetas: DataRowMeta[] = dataRows.map((r) => ({
    isUnexposed: r.isUnexposed,
    depth1Value: r.depth1Value,
  }));

  // varying label 열: computedLabels 값을 먼저 셀에 기록
  for (let ri = 0; ri < dataRows.length; ri++) {
    const semiRow = dataRows[ri];
    if (!semiRow.computedLabels) continue;
    const excelRowNum = HEADER_ROW_COUNT + ro + 1 + ri;
    for (const [ei, label] of semiRow.computedLabels) {
      setCellValue(ws.getRow(excelRowNum).getCell(measureStartCol + ei), label);
    }
  }

  applyCheckboxFormulas(ws, expandedColumns, measureStartCol, dataRowMetas, ro);
  applyHiddenAndValidation(ws, expandedColumns, measureStartCol, dataRows.length, ro);
  mergeExpandedH1Headers(ws, expandedColumns, measureStartCol, ro);

  ws.mergeCells(1, 1, 1, h1.length);

  applyAutoFilterAndFreeze(ws, h1.length, 2, ro);
  autoFitColumnWidths(ws);
  applyEmptyRowGrouping(ws, dataRows, ro);
}
