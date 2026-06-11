import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import {
  createStream,
  SavVariable,
  VariableAlignment,
  VariableType,
} from 'sav-writer';

import type { Question, QuestionOption, SurveySubmission } from '@/types/survey';

import { buildDataRows, generateSPSSColumns, SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { buildLabel, resolveMeasure, resolveVarType } from '@/lib/spss/variable-meta';
import { assertValidSpssVarNames } from '@/lib/spss/variable-name-guard';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { toSpssValueLabelPairs } from '@/utils/ranking-source';
import { sanitizeSpssVarName } from '@/utils/spss-var-name';

/**
 * QuestionOption[] → SPSS value labels 배열.
 * 기타(sentinel) 엔트리는 numeric 변수에서 system-missing 이라 자동 제외됨.
 */
function optionsToValueLabels(
  opts: QuestionOption[] | undefined,
): Array<{ value: string | number; label: string }> | undefined {
  const pairs = toSpssValueLabelPairs(opts).map(({ code, label }) => ({
    value: code,
    label,
  }));
  return pairs.length > 0 ? pairs : undefined;
}

// ── 상수 ──

const BATCH_SIZE = 500;
const DEFAULT_STRING_WIDTH = 256;
const MIN_STRING_WIDTH = 8;

/**
 * 값 라벨 생성
 */
export function buildValueLabels(
  col: SPSSExportColumn,
  question: Question | undefined,
): Array<{ label: string; value: string | number }> | undefined {
  switch (col.type) {
    case 'single':
      return optionsToValueLabels(question ? resolveChoiceOptions(question) : undefined);

    case 'ranking-rank':
      // col.cellOptions 에 Case 1 (question.options) 또는 Case 2 (소스 테이블 ranking_opt) 주입됨
      return optionsToValueLabels(col.cellOptions ?? question?.options);

    case 'checkbox-item': {
      const opts = question ? resolveChoiceOptions(question) : [];
      const code = opts[col.optionIndex ?? 0]?.spssNumericCode
        ?? (col.optionIndex ?? 0) + 1;
      return [{ value: code, label: '선택' }];
    }

    case 'notice-agree':
      return [{ value: 1, label: '동의' }];

    case 'radio-group': {
      // radio-group: generateSPSSColumns가 미리 계산한 valueLabels를 그대로 사용.
      // SPSS Variable View에서 작은 값부터 표시되도록 명시적 ascending 정렬.
      if (!col.radioGroupValueLabels) return undefined;
      return Object.entries(col.radioGroupValueLabels)
        .map(([value, label]) => ({ value: Number(value), label }))
        .sort((a, b) => Number(a.value) - Number(b.value));
    }

    case 'choice-group': {
      // choice-group: generateSPSSColumns가 미리 계산한 choiceGroupValueLabels를 그대로 사용.
      if (!col.choiceGroupValueLabels || col.choiceGroupValueLabels.length === 0) return undefined;
      return [...col.choiceGroupValueLabels].sort((a, b) => a.value - b.value);
    }

    case 'choice-group-item': {
      // choice-group-item: 이 보기의 counted 코드와 '선택' 라벨 1개만 — checkbox-item 과 동일 형태.
      const code = col.choiceGroupMemberCode;
      if (code == null) return undefined;
      return [{ value: code, label: '선택' }];
    }

    case 'table-cell': {
      if (col.tableCellType === 'input') return undefined;

      // checkbox 옵션별 분리: 해당 옵션의 코드만 (컬럼 메타 우선, 폴백 역참조)
      if (col.tableCellType === 'checkbox' && col.optionIndex != null) {
        const cellOpts = col.cellOptions
          ?? findTableCellOptions(question, col.tableCellId, 'checkbox');
        const code = cellOpts?.[col.optionIndex]?.spssNumericCode ?? col.optionIndex + 1;
        return [{ value: code, label: '선택' }];
      }

      // radio/select: 셀의 옵션들
      return optionsToValueLabels(
        findTableCellOptions(question, col.tableCellId, col.tableCellType || ''),
      );
    }

    case 'table-cell-ranking':
      // 셀의 rankingOptions 에서 value labels 구성 (컬럼 메타 우선, 폴백 findTableCellOptions)
      return optionsToValueLabels(
        col.cellOptions ?? findTableCellOptions(question, col.tableCellId, 'ranking'),
      );

    default:
      return undefined;
  }
}

/**
 * 테이블 셀의 옵션을 역참조
 */
function findTableCellOptions(
  question: Question | undefined,
  cellId: string | undefined,
  cellType: string,
) {
  if (!question?.tableRowsData || !cellId) return undefined;
  for (const row of question.tableRowsData) {
    for (const cell of row.cells) {
      if (cell.id === cellId) {
        if (cellType === 'radio') return cell.radioOptions;
        if (cellType === 'select') return cell.selectOptions;
        if (cellType === 'checkbox') return cell.checkboxOptions;
        if (cellType === 'ranking') return cell.rankingOptions;
      }
    }
  }
  return undefined;
}

// ── SPSS 변수명 sanitize: '@/utils/spss-var-name' 에서 import ──

// ── Short name 생성 ──

/**
 * 8자 이하 short name 생성 (중복 방지)
 */
function generateShortNames(varNames: string[]): string[] {
  const usedShorts = new Set<string>();
  return varNames.map((name) => {
    if (name.length <= 8) {
      usedShorts.add(name);
      return name;
    }
    // 앞 6자 + 숫자 suffix
    const base = name.slice(0, 6);
    let suffix = 1;
    let candidate = `${base}${suffix}`;
    while (usedShorts.has(candidate)) {
      suffix++;
      // suffix가 커지면 base 길이 줄이기
      const maxBase = 8 - String(suffix).length;
      candidate = `${name.slice(0, maxBase)}${suffix}`;
    }
    usedShorts.add(candidate);
    return candidate;
  });
}

// ── String width 계산 ──

/**
 * 각 열의 최대 문자열 바이트 길이를 계산 (8바이트 배수 올림)
 */
function computeMaxStringWidths(
  columns: SPSSExportColumn[],
  dataRows: (string | number | null)[][],
  questionMap: Map<string, Question>,
): number[] {
  return columns.map((col, colIdx) => {
    const varType = resolveVarType(col, questionMap.get(col.questionId));
    if (varType !== VariableType.String) return 0;

    let max = 0;
    for (const row of dataRows) {
      const val = row[colIdx];
      if (typeof val === 'string') {
        max = Math.max(max, Buffer.byteLength(val, 'utf-8'));
      }
    }

    if (max === 0) return DEFAULT_STRING_WIDTH;
    // 8바이트 배수로 올림
    return Math.max(Math.ceil(max / 8) * 8, MIN_STRING_WIDTH);
  });
}

// ── SavVariable 변환 ──

/**
 * SPSSExportColumn → SavVariable 변환
 */
function toSavVariable(
  col: SPSSExportColumn,
  question: Question | undefined,
  maxWidth: number,
  shortName: string,
): SavVariable {
  const varType = resolveVarType(col, question);
  const isNumeric = varType === VariableType.Numeric
    || varType === VariableType.Date
    || varType === VariableType.DateTime;

  const valueLabels = buildValueLabels(col, question);
  return {
    name: sanitizeSpssVarName(col.spssVarName),
    short: sanitizeSpssVarName(shortName),
    label: buildLabel(col),
    type: varType,
    width: isNumeric ? 0 : maxWidth,
    decimal: 0,
    alignment: VariableAlignment.Centre,
    measure: resolveMeasure(col, question),
    columns: isNumeric ? 8 : Math.min(maxWidth, 32),
    ...(valueLabels !== undefined ? { valueLabels } : {}),
  };
}

// ── Records 변환 ──

/**
 * 2차원 배열 → sav-writer records 변환
 */
function buildSavRecords(
  columns: SPSSExportColumn[],
  dataRows: (string | number | null)[][],
): Array<{ [key: string]: unknown }> {
  return dataRows.map((row) => {
    const record: { [key: string]: unknown } = {};
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (!col) continue;
      let val = row[i];

      // notice-agree: '동의' → 1 (Numeric 타입)
      if (col.type === 'notice-agree' && val === '동의') {
        val = 1;
      }

      // null → undefined (sav-writer에서 system-missing 처리)
      record[col.spssVarName] = val ?? undefined;
    }
    return record;
  });
}

// ── 메인 함수 ──

/**
 * SPSS .sav 파일을 Buffer로 생성한다.
 * createStream을 사용하여 배치 단위로 쓰기 (메모리 절약)
 */
export async function generateSavBuffer(
  questions: Question[],
  submissions: SurveySubmission[],
): Promise<Buffer> {
  const columns = generateSPSSColumns(questions);
  // 변수명 가드: invalid/중복이면 명시적 에러 (silent 치환 금지 — C1 차단)
  assertValidSpssVarNames(columns);
  const dataRows = buildDataRows(columns, questions, submissions);

  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const maxWidths = computeMaxStringWidths(columns, dataRows, questionMap);

  // short name 생성
  const shortNames = generateShortNames(columns.map((c) => c.spssVarName));

  // SavVariable[] 생성
  const variables = columns.map((col, i) =>
    toSavVariable(col, questionMap.get(col.questionId), maxWidths[i] ?? 0, shortNames[i] ?? col.spssVarName),
  );

  const tmpPath = join(tmpdir(), `sav_${randomUUID()}.sav`);

  try {
    const stream = createStream({
      variables,
      length: dataRows.length,
      path: tmpPath,
    });

    // 배치 단위로 나눠서 쓰기
    for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
      const batch = dataRows.slice(i, i + BATCH_SIZE);
      const records = buildSavRecords(columns, batch);
      stream.write(records);
    }

    // 데이터가 없어도 stream.end()는 호출해야 파일이 완성됨
    await stream.end();

    return await readFile(tmpPath);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
