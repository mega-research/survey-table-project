import ExcelJS from 'exceljs';

import { buildCodebookValueLabel } from '@/lib/analytics/raw-export-helpers';
import { bucketQuestions, planSplit } from '@/lib/analytics/split-export';
import { buildDataRow, generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { Question, SurveySubmission } from '@/types/survey';

import {
  type RawExportContext,
  type RawExportResponseRow,
  addResponseListSheet,
  autoFitRawColumnRange,
  autoFitRawColumns,
  buildRawMetaHeaders,
  buildRawMetaValues,
  clampRawWidth,
  estimateTextWidth,
  row2Label,
  styleHeaderRows,
} from './raw-workbook';

/** 분할 내보내기 워크북: 응답내역 + 공통 + 옵션별 + 코딩북 (열만 분할, 행 전체 공통) */
export function buildSplitWorkbook(
  questions: Question[],
  rows: RawExportResponseRow[],
  basisQuestionId: string,
  ctx: RawExportContext,
): ExcelJS.Workbook {
  const sortedQuestions = [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const questionMap = new Map(sortedQuestions.map((q) => [q.id, q]));

  // planSplit이 assignSplitSheetNames 적용 후 최종 시트명을 s.name에 보관한다.
  // buildSplitWorkbook은 plan.sheets를 그대로 따라 옵션 시트를 생성해 이름 일관성을 보장한다.
  const plan = planSplit(sortedQuestions, basisQuestionId);

  const workbook = new ExcelJS.Workbook();

  // 변수 시트(공통/옵션) — bucketQuestions 결과로 헤더 3행 + 전체 응답자 데이터
  // 옵션 시트명 유일성은 assignSplitSheetNames(reserved 시드 포함)가 보장하므로 중복 방어 불필요.
  const addVariableSheet = (name: string, bucketQs: Question[]) => {
    const columns = generateSPSSColumns(bucketQs);
    const ws = workbook.addWorksheet(name);
    const metaHeaders = buildRawMetaHeaders(ctx);
    const metaCount = metaHeaders.length;
    const colCount = columns.length + metaCount;
    ws.addRow([...metaHeaders, ...columns.map((c) => c.questionText)]);
    ws.addRow([...metaHeaders.map(() => ''), ...columns.map((c) => row2Label(c))]);
    ws.addRow([...metaHeaders.map(() => ''), ...columns.map((c) => c.spssVarName)]);
    // 데이터는 전체 응답자 + 이 버킷 컬럼만 (열만 분할)
    rows.forEach((row, i) => {
      ws.addRow([
        ...buildRawMetaValues(row, i + 1, ctx),
        ...buildDataRow(columns, questionMap, row as unknown as SurveySubmission),
      ]);
    });

    styleHeaderRows(ws, [1, 2, 3], colCount);
    for (let c = 1; c <= metaCount; c++) ws.mergeCells(1, c, 3, c);
    let start = 0;
    while (start < columns.length) {
      let end = start;
      while (end + 1 < columns.length && columns[end + 1]?.questionId === columns[start]?.questionId)
        end++;
      if (end > start) ws.mergeCells(1, start + metaCount + 1, 1, end + metaCount + 1);
      start = end + 1;
    }
    autoFitRawColumnRange(ws, 1, metaCount);
    columns.forEach((c, i) => {
      ws.getColumn(i + metaCount + 1).width = clampRawWidth(estimateTextWidth(row2Label(c)));
    });
  };

  // 시트 1: 응답 내역 (전체 응답자) — Raw 워크북과 공용 빌더, 조건부 열 규칙 동일
  addResponseListSheet(workbook, rows, ctx);

  // 시트 2: 공통 — 고정 이름
  addVariableSheet('공통', bucketQuestions(sortedQuestions, basisQuestionId, 'common'));

  // 시트 3..N: 옵션별 — plan.sheets 순서와 이름을 그대로 사용 (BY CONSTRUCTION 일치)
  for (const s of plan.sheets) {
    addVariableSheet(s.name, bucketQuestions(sortedQuestions, basisQuestionId, s.token));
  }

  // 마지막 시트: 코딩북 (전체 변수) — 고정 이름
  const allColumns = generateSPSSColumns(sortedQuestions);
  const wsCb = workbook.addWorksheet('코딩북');
  wsCb.addRow(['변수번호', 'SPSS 변수명', '질문 제목', '셀라벨', '값 라벨']);
  allColumns.forEach((c, i) => {
    wsCb.addRow([
      i + 1,
      c.spssVarName,
      c.questionText,
      c.cellExportLabel ?? '',
      buildCodebookValueLabel(c, questionMap),
    ]);
  });
  styleHeaderRows(wsCb, [1], 5);
  autoFitRawColumns(wsCb, 5);

  return workbook;
}
