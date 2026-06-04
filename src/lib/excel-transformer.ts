import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

import { HEADER_BORDER, HEADER_FILL, HEADER_FONT } from '@/lib/analytics/cleaning-export-types';
import { isCellInputable } from '@/lib/analytics/excel-export-utils';
import { buildCodebookValueLabel, formatExcelDateTime } from '@/lib/analytics/raw-export-helpers';
import { bucketQuestions, planSplit } from '@/lib/analytics/split-export';
import {
  type SPSSExportColumn,
  buildDataRow,
  generateSPSSColumns,
} from '@/lib/analytics/spss-excel-export';
import { type Platform, formatPlatformKo } from '@/lib/operations/parse-ua';
import { formatTotalTime, mapStatusPill } from '@/lib/operations/profiles';
import { Question, Survey, SurveySubmission } from '@/types/survey';
import { resolveRankingOptions, toSpssValueLabelPairs } from '@/utils/ranking-source';
import { buildTableCellVarName, resolveRankVarName } from '@/utils/table-cell-code-generator';

/**
 * Summary 워크북 생성
 */
export function generateSummaryWorkbook(
  survey: Survey,
  responses: SurveySubmission[],
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const summaryData = generateSummaryData(survey, responses);
  const ws = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, ws, 'Summary');
  return workbook;
}

/**
 * Variable Map 워크북 생성
 */
export function generateVariableMapWorkbook(survey: Survey): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const mapData = generateVariableMap(survey);
  const ws = XLSX.utils.json_to_sheet(mapData);
  ws['!cols'] = [{ wch: 38 }, { wch: 14 }, { wch: 22 }, { wch: 40 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(workbook, ws, 'Variable Map');
  return workbook;
}

// ============================================================
// Internal: Summary
// ============================================================

function generateSummaryData(survey: Survey, responses: SurveySubmission[]) {
  const summary: any[] = [];
  const totalResponses = responses.length;

  [...survey.questions]
    .sort((a, b) => a.order - b.order)
    .forEach((q) => {
      if (q.type === 'notice') return;

      summary.push({
        구분: `[${q.type}] ${q.title}`,
        '응답 수': '',
        '비율(%)': '',
      });

      if (q.type === 'table' && q.tableRowsData && q.tableColumns) {
        q.tableRowsData.forEach((row) => {
          q.tableColumns!.forEach((col, colIndex) => {
            const cell = row.cells[colIndex];
            if (!cell || !isCellInputable(cell)) return;

            const count = responses.filter((r) => {
              const ans = (r.questionResponses as any)?.[q.id];
              const val = ans && ans[cell.id];

              if (!val) return false;
              if (Array.isArray(val)) return val.length > 0;
              if (typeof val === 'string') return val.trim().length > 0;
              return true;
            }).length;

            summary.push({
              구분: `  - ${row.label} > ${col.label}`,
              '응답 수': count,
              '비율(%)': (totalResponses > 0 ? (count / totalResponses) * 100 : 0).toFixed(1) + '%',
            });

            // ranking 셀(Case 3): 옵션별 가중치 총점 + 응답 수 추가
            if (cell.type === 'ranking' && cell.rankingOptions && cell.rankingOptions.length > 0) {
              const N = Math.max(1, cell.rankingConfig?.positions ?? 3);
              cell.rankingOptions.forEach((opt) => {
                let totalScore = 0;
                let optCount = 0;
                responses.forEach((r) => {
                  const ans = (r.questionResponses as any)?.[q.id];
                  const cellVal = ans && ans[cell.id];
                  if (!Array.isArray(cellVal)) return;
                  const entry = cellVal.find((a: any) => a?.optionValue === opt.value);
                  if (
                    entry &&
                    typeof entry.rank === 'number' &&
                    entry.rank >= 1 &&
                    entry.rank <= N
                  ) {
                    totalScore += N - entry.rank + 1;
                    optCount++;
                  }
                });
                summary.push({
                  구분: `      · ${opt.label} (총점 ${totalScore})`,
                  '응답 수': optCount,
                  '비율(%)':
                    (totalResponses > 0 ? (optCount / totalResponses) * 100 : 0).toFixed(1) + '%',
                });
              });
            }
          });
        });
      } else if (q.type === 'multiselect' && q.selectLevels) {
        q.selectLevels.forEach((level) => {
          summary.push({
            구분: `  [${level.label}]`,
            '응답 수': '',
            '비율(%)': '',
          });

          level.options.forEach((opt) => {
            const count = responses.filter((r) => {
              const ans = (r.questionResponses as any)?.[q.id];
              return ans && ans[level.id] === opt.value;
            }).length;

            summary.push({
              구분: `    - ${opt.label}`,
              '응답 수': count,
              '비율(%)': (totalResponses > 0 ? (count / totalResponses) * 100 : 0).toFixed(1) + '%',
            });
          });
        });
      } else if (q.type === 'ranking') {
        // Case 1/2 공통 — resolveRankingOptions 로 옵션 통합
        const resolved = resolveRankingOptions(q);
        const N = Math.max(1, q.rankingConfig?.positions ?? 3);
        resolved.forEach((opt) => {
          let totalScore = 0;
          let count = 0;
          responses.forEach((r) => {
            const ans = (r.questionResponses as any)?.[q.id];
            if (!Array.isArray(ans)) return;
            const entry = ans.find((a: any) => a?.optionValue === opt.value);
            if (entry && typeof entry.rank === 'number' && entry.rank >= 1 && entry.rank <= N) {
              totalScore += N - entry.rank + 1;
              count++;
            }
          });
          summary.push({
            구분: `  - ${opt.label} (총점 ${totalScore})`,
            '응답 수': count,
            '비율(%)': (totalResponses > 0 ? (count / totalResponses) * 100 : 0).toFixed(1) + '%',
          });
        });
      } else if (q.options) {
        q.options.forEach((opt) => {
          const count = responses.filter((r) => {
            const ans = (r.questionResponses as any)?.[q.id];
            if (Array.isArray(ans)) return ans.includes(opt.value);
            return ans === opt.value;
          }).length;

          summary.push({
            구분: `  - ${opt.label}`,
            '응답 수': count,
            '비율(%)': (totalResponses > 0 ? (count / totalResponses) * 100 : 0).toFixed(1) + '%',
          });
        });
      }

      summary.push({});
    });

  return summary;
}

// ============================================================
// Internal: Variable Map
// ============================================================

function generateVariableMap(survey: Survey) {
  const mapData: Record<string, string>[] = [];

  survey.questions
    .sort((a, b) => a.order - b.order)
    .forEach((q) => {
      if (q.type === 'notice' && !q.requiresAcknowledgment) return;

      let valueLabels = '';
      if (q.type === 'notice' && q.requiresAcknowledgment) {
        valueLabels = '동의=확인함, 빈값=미확인';
      } else if (
        (q.type === 'radio' ||
          q.type === 'select' ||
          q.type === 'checkbox' ||
          q.type === 'ranking') &&
        q.options
      ) {
        valueLabels = q.options
          .map((o, i) => `${o.spssNumericCode ?? i + 1}=${o.label}`)
          .join(', ');
      }

      mapData.push({
        '질문 ID': q.id,
        타입: q.type,
        'SPSS 변수명': q.questionCode || '',
        '질문 제목': q.title,
        '값 라벨': valueLabels,
      });

      if (q.options && ['radio', 'select', 'checkbox'].includes(q.type)) {
        q.options.forEach((opt, i) => {
          mapData.push({
            '질문 ID': '',
            타입: 'Option',
            'SPSS 변수명':
              q.type === 'checkbox' ? `${q.questionCode}_${opt.optionCode ?? String(i + 1)}` : '',
            '질문 제목': `  ${opt.spssNumericCode ?? i + 1}. ${opt.label}`,
            '값 라벨': `Value: ${opt.value}`,
          });
          // allowTextInput 옵션마다 _text 컬럼 추가
          if (opt.allowTextInput) {
            const varNumber = opt.optionCode ?? String(i + 1);
            mapData.push({
              '질문 ID': '',
              타입: 'Option Text',
              'SPSS 변수명': `${q.questionCode}_${varNumber}_text`,
              '질문 제목': `  ${opt.label} (텍스트 입력)`,
              '값 라벨': '(텍스트)',
            });
          }
        });
      }

      if (q.type === 'ranking') {
        // Case 1/2 공통: 변수명 동일, 값 라벨은 resolveRankingOptions 로 통합.
        // 기타(sentinel) 엔트리는 numeric 변수에서 system-missing 이라 라벨에서 자동 제외됨.
        const resolved = resolveRankingOptions(q);
        const labelPairs = toSpssValueLabelPairs(resolved);
        const rankingValueLabels =
          labelPairs.length > 0
            ? labelPairs.map((p) => `${p.code}=${p.label}`).join(', ')
            : '(옵션 없음)';
        const N = Math.max(1, q.rankingConfig?.positions ?? 3);
        for (let k = 1; k <= N; k++) {
          mapData.push({
            '질문 ID': '',
            타입: `Ranking (${k}순위)`,
            'SPSS 변수명': `${q.questionCode}_rk${k}`,
            '질문 제목': `  ${k}순위`,
            '값 라벨': rankingValueLabels,
          });
        }
      }

      if (q.type === 'table' && q.tableRowsData && q.tableColumns) {
        q.tableRowsData.forEach((row) => {
          q.tableColumns!.forEach((col, colIndex) => {
            const cell = row.cells[colIndex];
            if (!cell || !isCellInputable(cell)) return;
            // 셀코드가 의도적으로 비어있으면 내보내기에서 제외 (표시용 셀)
            if (cell.isCustomCellCode === true && !cell.cellCode) return;

            // ranking 셀(Case 3): positions 만큼 _rk{k} / _rk{k}_etc 변수 행을 따로 생성
            if (cell.type === 'ranking') {
              const baseVarName =
                cell.cellCode ||
                buildTableCellVarName(q, row, colIndex, q.tableColumns!, q.tableRowsData!);
              const opts = cell.rankingOptions ?? [];
              const rankingValueLabels =
                opts.length > 0
                  ? opts.map((o, i) => `${o.spssNumericCode ?? i + 1}=${o.label}`).join(', ')
                  : '';
              const positions = Math.max(1, cell.rankingConfig?.positions ?? 3);
              for (let k = 1; k <= positions; k++) {
                const rankVar = resolveRankVarName(
                  baseVarName,
                  cell.rankSuffixPattern,
                  cell.rankVarNames,
                  k,
                );
                mapData.push({
                  '질문 ID': '',
                  타입: `Table (ranking ${k}순위)`,
                  'SPSS 변수명': rankVar,
                  '질문 제목': `  ${row.label} - ${col.label} (${k}순위)`,
                  '값 라벨': rankingValueLabels || '(순위형 옵션 없음)',
                });
              }
              return;
            }

            const varName =
              cell.cellCode ||
              cell.exportLabel ||
              `${q.questionCode}_${row.rowCode || row.label}_${col.columnCode || col.label}`;

            let cellValueLabels = '';
            if (cell.type === 'checkbox') {
              cellValueLabels = '1=선택, 빈값=미선택';
            } else {
              const opts = cell.radioOptions || cell.selectOptions;
              if (opts && opts.length > 0) {
                cellValueLabels = opts
                  .map((o, i) => `${o.spssNumericCode ?? i + 1}=${o.label}`)
                  .join(', ');
              }
            }

            mapData.push({
              '질문 ID': '',
              타입: `Table (${cell.type})`,
              'SPSS 변수명': varName,
              '질문 제목': `  ${row.label} - ${col.label}`,
              '값 라벨': cellValueLabels || `(${cell.type})`,
            });
          });
        });
      }

      if (q.type === 'multiselect' && q.selectLevels) {
        q.selectLevels.forEach((level) => {
          mapData.push({
            '질문 ID': '',
            타입: 'Select Level',
            'SPSS 변수명': '',
            '질문 제목': `  [Level] ${level.label}`,
            '값 라벨': level.options.map((o) => o.label).join(', '),
          });
        });
      }
    });

  return mapData;
}

// ============================================================
// Raw Data 워크북
// ============================================================

export interface RawExportResponseRow {
  id: string;
  questionResponses: Record<string, unknown>;
  groupValue: string | null;
  resid: number | null;
  platform: string | null;
  browser: string | null;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  totalSeconds: number | null;
}

export type RawIdentifierMode = 'sequence' | 'systemId';

/**
 * 시트 분리 없는 3시트 Raw Data 워크북.
 * - 응답 내역: 응답자 메타 (응답 내역 페이지 재현)
 * - Raw Data: 응답 × 변수 wide table (SPSS 코드값), 헤더 3행
 * - 코딩북: 변수 정의 + 값 라벨
 * rows 는 started_at ASC 정렬된 동일 모수.
 */
export function generateRawDataWorkbook(
  questions: Question[],
  rows: RawExportResponseRow[],
  identifierMode: RawIdentifierMode,
): ExcelJS.Workbook {
  const idHeader = identifierMode === 'systemId' ? 'systemID' : '순번';
  // systemId 모드에서 컨택 미매칭(익명) 응답은 resid가 없어 식별자 칸을 공백으로 둔다.
  const idValue = (row: RawExportResponseRow, idx: number): string | number =>
    identifierMode === 'systemId' ? (row.resid ?? '') : idx + 1;

  // 질문은 order 순으로 정렬해 컬럼/코딩북 순서를 설문 표시 순서와 일치시킨다.
  // (Summary/VariableMap 워크북도 동일하게 order 정렬을 적용한다.)
  const sortedQuestions = [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const columns = generateSPSSColumns(sortedQuestions);
  const questionMap = new Map(sortedQuestions.map((q) => [q.id, q]));

  const workbook = new ExcelJS.Workbook();

  // 시트 1: 응답 내역
  const ws1 = workbook.addWorksheet('응답 내역');
  ws1.addRow([
    idHeader,
    '조사 대상 그룹',
    '접속 단말',
    '브라우저',
    '상태',
    '시작일시',
    '종료일시',
    '소요시간',
  ]);
  rows.forEach((row, i) => {
    ws1.addRow([
      idValue(row, i),
      row.groupValue ?? '공개링크',
      formatPlatformKo(row.platform as Platform | null),
      row.browser ?? 'Other',
      mapStatusPill({ status: row.status }).label,
      formatExcelDateTime(row.startedAt),
      // 상태는 별도 컬럼이 표시하므로 종료일시는 순수 시각만(미완료/이탈은 null → 공백).
      formatExcelDateTime(row.completedAt),
      formatTotalTime(row.totalSeconds, row.status),
    ]);
  });
  styleHeaderRows(ws1, [1], 8);
  autoFitRawColumns(ws1, 8);

  // 시트 2: Raw Data (헤더 3행 = 질문제목 / 셀라벨 / SPSS 변수명)
  const ws2 = workbook.addWorksheet('Raw Data');
  const colCount = columns.length + 1; // 식별자 1열 + 변수 열
  ws2.addRow([idHeader, ...columns.map((c) => c.questionText)]);
  ws2.addRow(['', ...columns.map((c) => row2Label(c))]);
  ws2.addRow(['', ...columns.map((c) => c.spssVarName)]);
  rows.forEach((row, i) => {
    ws2.addRow([
      idValue(row, i),
      ...buildDataRow(columns, questionMap, row as unknown as SurveySubmission),
    ]);
  });

  // 1~3행 헤더 스타일
  styleHeaderRows(ws2, [1, 2, 3], colCount);
  // 식별자 열은 1~3행 세로 병합
  ws2.mergeCells(1, 1, 3, 1);
  // 1행: 같은 질문(questionId)에 속한 연속 변수 열을 가로 병합
  let start = 0;
  while (start < columns.length) {
    let end = start;
    while (end + 1 < columns.length && columns[end + 1]?.questionId === columns[start]?.questionId) {
      end++;
    }
    if (end > start) ws2.mergeCells(1, start + 2, 1, end + 2);
    start = end + 1;
  }
  // 열 너비: 변수 열은 2행(셀라벨) 컨텐츠 기준
  ws2.getColumn(1).width = clampRawWidth(estimateTextWidth(idHeader));
  columns.forEach((c, i) => {
    ws2.getColumn(i + 2).width = clampRawWidth(estimateTextWidth(row2Label(c)));
  });

  // 시트 3: 코딩북
  const ws3 = workbook.addWorksheet('코딩북');
  ws3.addRow(['변수번호', 'SPSS 변수명', '질문 제목', '셀라벨', '값 라벨']);
  columns.forEach((c, i) => {
    ws3.addRow([
      i + 1,
      c.spssVarName,
      c.questionText,
      c.cellExportLabel ?? '',
      buildCodebookValueLabel(c, questionMap),
    ]);
  });
  styleHeaderRows(ws3, [1], 5);
  autoFitRawColumns(ws3, 5);

  return workbook;
}

/** 분할 내보내기 워크북: 응답내역 + 공통 + 옵션별 + 코딩북 (열만 분할, 행 전체 공통) */
export function buildSplitWorkbook(
  questions: Question[],
  rows: RawExportResponseRow[],
  basisQuestionId: string,
  identifierMode: RawIdentifierMode,
): ExcelJS.Workbook {
  const idHeader = identifierMode === 'systemId' ? 'systemID' : '순번';
  const idValue = (row: RawExportResponseRow, idx: number): string | number =>
    identifierMode === 'systemId' ? (row.resid ?? '') : idx + 1;

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
    const colCount = columns.length + 1;
    ws.addRow([idHeader, ...columns.map((c) => c.questionText)]);
    ws.addRow(['', ...columns.map((c) => row2Label(c))]);
    ws.addRow(['', ...columns.map((c) => c.spssVarName)]);
    // 데이터는 전체 응답자 + 이 버킷 컬럼만 (열만 분할)
    rows.forEach((row, i) => {
      ws.addRow([
        idValue(row, i),
        ...buildDataRow(columns, questionMap, row as unknown as SurveySubmission),
      ]);
    });

    styleHeaderRows(ws, [1, 2, 3], colCount);
    ws.mergeCells(1, 1, 3, 1);
    let start = 0;
    while (start < columns.length) {
      let end = start;
      while (end + 1 < columns.length && columns[end + 1]?.questionId === columns[start]?.questionId)
        end++;
      if (end > start) ws.mergeCells(1, start + 2, 1, end + 2);
      start = end + 1;
    }
    ws.getColumn(1).width = clampRawWidth(estimateTextWidth(idHeader));
    columns.forEach((c, i) => {
      ws.getColumn(i + 2).width = clampRawWidth(estimateTextWidth(row2Label(c)));
    });
  };

  // 시트 1: 응답 내역 (전체 응답자) — 고정 이름
  const ws1 = workbook.addWorksheet('응답 내역');
  ws1.addRow([
    idHeader,
    '조사 대상 그룹',
    '접속 단말',
    '브라우저',
    '상태',
    '시작일시',
    '종료일시',
    '소요시간',
  ]);
  rows.forEach((row, i) => {
    ws1.addRow([
      idValue(row, i),
      row.groupValue ?? '공개링크',
      formatPlatformKo(row.platform as Platform | null),
      row.browser ?? 'Other',
      mapStatusPill({ status: row.status }).label,
      formatExcelDateTime(row.startedAt),
      formatExcelDateTime(row.completedAt),
      formatTotalTime(row.totalSeconds, row.status),
    ]);
  });
  styleHeaderRows(ws1, [1], 8);
  autoFitRawColumns(ws1, 8);

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

// ── Raw 워크북 스타일/레이아웃 헬퍼 ──

const RAW_MIN_WIDTH = 8;
const RAW_MAX_WIDTH = 60;
const RAW_WIDTH_PADDING = 2;

/** 텍스트 표시 너비 추정 (CJK 문자 1.8배). */
function estimateTextWidth(value: unknown): number {
  if (value === null || value === undefined) return 0;
  let width = 0;
  for (const ch of String(value)) {
    const code = ch.codePointAt(0) ?? 0;
    const isCjk =
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef);
    width += isCjk ? 1.8 : 1;
  }
  return width;
}

function clampRawWidth(width: number): number {
  return Math.min(RAW_MAX_WIDTH, Math.max(RAW_MIN_WIDTH, width + RAW_WIDTH_PADDING));
}

/** 지정한 행들을 헤더 스타일(파란 배경 + 흰 굵은 글씨 + 테두리 + 가운데 정렬)로 칠한다. */
function styleHeaderRows(ws: ExcelJS.Worksheet, rowNums: number[], colCount: number): void {
  for (const rowNum of rowNums) {
    const row = ws.getRow(rowNum);
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = HEADER_BORDER;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    }
    row.height = 22;
  }
}

/** 헤더 + 데이터 일부를 표본으로 열 너비를 자동 맞춤 (시트1/코딩북용). */
function autoFitRawColumns(ws: ExcelJS.Worksheet, colCount: number): void {
  const sampleEnd = Math.min(ws.rowCount, 200);
  for (let c = 1; c <= colCount; c++) {
    let max = 0;
    for (let r = 1; r <= sampleEnd; r++) {
      max = Math.max(max, estimateTextWidth(ws.getRow(r).getCell(c).value));
    }
    ws.getColumn(c).width = clampRawWidth(max);
  }
}

/** Raw Data 헤더 행2: 테이블 셀라벨 > 옵션 분리 열 라벨 > 공백 */
function row2Label(c: SPSSExportColumn): string {
  if (c.cellExportLabel) return c.cellExportLabel;
  if (
    c.type === 'checkbox-item' ||
    c.type === 'ranking-rank' ||
    c.type === 'ranking-other' ||
    c.type === 'option-text' ||
    c.type === 'other-text' ||
    c.type === 'table-cell-option-text' ||
    c.type === 'table-cell-ranking-other'
  ) {
    return c.optionLabel ?? '';
  }
  return '';
}
