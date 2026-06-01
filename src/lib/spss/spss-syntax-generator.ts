import type { Question, QuestionOption, TableCell, TableRow } from '@/types/survey';

import {
  hasOtherRankingCell,
  resolveRankingOptions,
  toSpssValueLabelPairs,
} from '@/utils/ranking-source';
import { buildTableCellVarName, resolveRankVarName } from '@/utils/table-cell-code-generator';
import { buildOptionTextVarName } from '@/utils/spss-var-name';
import { resolveChoiceOptions } from '@/utils/choice-source';

/**
 * allowTextInput 옵션마다 STRING 변수 메타데이터를 생성한다.
 * 변수명 규칙: {qVar}_{varNumber}_text
 * varNumber = optionCode (있는 경우) 또는 1-based 인덱스
 */
function generateOptionTextVariables(
  question: Question,
): Array<{ name: string; type: 'STRING'; width: number; label: string }> {
  const vars: Array<{ name: string; type: 'STRING'; width: number; label: string }> = [];
  const qVar = question.questionCode ?? `Q${question.order}`;

  for (let i = 0; i < (question.options ?? []).length; i++) {
    const option = question.options![i];
    if (!option.allowTextInput) continue;
    const varNumber = option.optionCode ?? String(i + 1);
    vars.push({
      name: buildOptionTextVarName(qVar, varNumber),
      type: 'STRING',
      width: 255,
      label: `${question.title} - ${option.label} (텍스트)`,
    });
  }

  return vars;
}

/**
 * 테이블 셀의 옵션들에서 allowTextInput STRING 변수 메타데이터를 생성한다.
 * 변수명 규칙: {cellVarName}_{varNumber}_text
 */
function generateCellOptionTextVariables(
  cellVarName: string,
  questionTitle: string,
  options: Array<{ id: string; label: string; optionCode?: string; allowTextInput?: boolean }>,
): Array<{ name: string; type: 'STRING'; width: number; label: string }> {
  const vars: Array<{ name: string; type: 'STRING'; width: number; label: string }> = [];
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt.allowTextInput) continue;
    const varNumber = opt.optionCode ?? String(i + 1);
    vars.push({
      name: buildOptionTextVarName(cellVarName, varNumber),
      type: 'STRING',
      width: 255,
      label: `${questionTitle} - ${opt.label} (텍스트)`,
    });
  }
  return vars;
}

/** SPSS 문자열 리터럴에서 작은따옴표를 이스케이프한다. */
function esc(str: string): string {
  return str.replace(/'/g, "''");
}

interface TableRankingCellInfo {
  cell: TableCell;
  row: TableRow;
  colIdx: number;
  baseVarName: string;
  suffixPattern: string | undefined;
  varNameOverrides: string[] | undefined;
  rowLabel: string;
  colLabel: string;
  positions: number;
  options: QuestionOption[];
  allowOther: boolean;
}

/**
 * 테이블 질문에서 Case 3 ranking 셀들의 메타데이터를 수집.
 * spss-excel-export.ts 의 generateSPSSColumns 와 동일한 변수명 규칙 사용.
 */
function collectTableRankingCells(q: Question): TableRankingCellInfo[] {
  if (q.type !== 'table' || !q.tableRowsData || !q.tableColumns || !q.questionCode) return [];
  const result: TableRankingCellInfo[] = [];
  for (const row of q.tableRowsData) {
    for (let colIdx = 0; colIdx < q.tableColumns.length; colIdx++) {
      const cell = row.cells[colIdx];
      if (!cell || cell.type !== 'ranking') continue;
      if (cell.isCustomCellCode === true && !cell.cellCode) continue;
      const baseVarName = cell.cellCode
        || buildTableCellVarName(q, row, colIdx, q.tableColumns, q.tableRowsData);
      result.push({
        cell,
        row,
        colIdx,
        baseVarName,
        suffixPattern: cell.rankSuffixPattern,
        varNameOverrides: cell.rankVarNames,
        rowLabel: row.label,
        colLabel: q.tableColumns[colIdx].label,
        positions: Math.max(1, cell.rankingConfig?.positions ?? 3),
        options: cell.rankingOptions ?? [],
        allowOther: cell.allowOtherOption === true,
      });
    }
  }
  return result;
}

/**
 * VARIABLE LABELS 신택스를 생성한다.
 * - 단일선택/텍스트/다단계: 변수 1개
 * - 복수선택: 옵션별 하위 변수 (Q2_1, Q2_2...)
 */
export function generateVariableLabels(questions: Question[]): string {
  const lines: string[] = [];

  for (const q of questions) {
    // notice 중 requiresAcknowledgment가 있으면 동의 + 날짜 변수 생성
    if (q.type === 'notice') {
      if (q.requiresAcknowledgment && q.questionCode) {
        lines.push(`  ${q.questionCode} '${esc(q.title)} - 동의 여부'`);
        lines.push(`  ${q.questionCode}_DATE '${esc(q.title)} - 동의 일시'`);
      }
      continue;
    }
    if (!q.questionCode) continue;

    if (q.type === 'checkbox' && q.options) {
      for (let i = 0; i < q.options.length; i++) {
        const opt = q.options[i];
        lines.push(`  ${q.questionCode}_${opt.optionCode ?? String(i + 1)} '${esc(q.title)} - ${i + 1}. ${esc(opt.label)}'`);
        // allowTextInput 옵션마다 STRING 사이드카 텍스트 변수 라벨 생성
        if (opt.allowTextInput) {
          const varNumber = opt.optionCode ?? String(i + 1);
          lines.push(`  ${buildOptionTextVarName(q.questionCode, varNumber)} '${esc(q.title)} - ${esc(opt.label)} (텍스트)'`);
        }
      }
    } else if (q.type === 'ranking') {
      // Case 1/2 공통 — 변수명 규칙 동일, Case 2 라벨 소스는 generateValueLabels 에서 다름
      const positions = Math.max(1, q.rankingConfig?.positions ?? 3);
      const needsOtherColumn = q.allowOtherOption || hasOtherRankingCell(q);
      for (let k = 1; k <= positions; k++) {
        lines.push(`  ${q.questionCode}_rk${k} '${esc(q.title)} (${k}순위)'`);
        if (needsOtherColumn) {
          lines.push(`  ${q.questionCode}_rk${k}_etc '${esc(q.title)} - ${k}순위 기타 입력'`);
        }
      }
    } else if (q.type === 'table') {
      // table 질문의 Case 3 ranking 셀에 대한 변수 라벨
      for (const info of collectTableRankingCells(q)) {
        for (let k = 1; k <= info.positions; k++) {
          const rankVar = resolveRankVarName(info.baseVarName, info.suffixPattern, info.varNameOverrides, k);
          lines.push(
            `  ${rankVar} '${esc(q.title)} - ${esc(info.rowLabel)} > ${esc(info.colLabel)} (${k}순위)'`,
          );
          if (info.allowOther) {
            lines.push(
              `  ${rankVar}_etc '${esc(q.title)} - ${esc(info.rowLabel)} > ${esc(info.colLabel)} - ${k}순위 기타 입력'`,
            );
          }
        }
      }
      // 테이블 셀의 allowTextInput 옵션마다 STRING 사이드카 텍스트 변수 라벨 생성
      if (q.tableRowsData && q.tableColumns) {
        for (const tRow of q.tableRowsData) {
          for (let colIdx = 0; colIdx < q.tableColumns.length; colIdx++) {
            const cell = tRow.cells[colIdx];
            if (!cell) continue;
            if (cell.isCustomCellCode === true && !cell.cellCode) continue;
            const cellVarName = cell.cellCode
              || buildTableCellVarName(q, tRow, colIdx, q.tableColumns, q.tableRowsData!);
            const cellOpts =
              cell.type === 'checkbox' ? cell.checkboxOptions
              : cell.type === 'radio' ? cell.radioOptions
              : cell.type === 'select' ? cell.selectOptions
              : undefined;
            if (!cellOpts) continue;
            for (const v of generateCellOptionTextVariables(cellVarName, q.title, cellOpts)) {
              lines.push(`  ${v.name} '${esc(v.label)}'`);
            }
          }
        }
      }
    } else {
      lines.push(`  ${q.questionCode} '${esc(q.title)}'`);
      // radio/select: allowTextInput 옵션마다 STRING 사이드카 텍스트 변수 라벨 생성
      if ((q.type === 'radio' || q.type === 'select') && q.options) {
        for (const v of generateOptionTextVariables(q)) {
          lines.push(`  ${v.name} '${esc(v.label)}'`);
        }
      }
    }
  }

  if (lines.length === 0) return '';
  return `* 변수 라벨 설정.\nVARIABLE LABELS\n${lines.join('\n')}.`;
}

/**
 * VALUE LABELS 신택스를 생성한다.
 * - 단일선택(radio, select): 모든 옵션의 숫자코드=라벨
 * - 복수선택(checkbox): 각 하위 변수에 "코드='선택'"
 */
export function generateValueLabels(questions: Question[]): string {
  const entries: string[] = [];

  for (const q of questions) {
    // notice 동의 변수 값 라벨
    if (q.type === 'notice' && q.requiresAcknowledgment && q.questionCode) {
      entries.push(`  ${q.questionCode} 1 '동의'`);
      continue;
    }

    // ranking: Case 1 + Case 2 공통 처리 — options 직접 사용 대신 resolveRankingOptions
    if (q.type === 'ranking' && q.questionCode) {
      const resolved = resolveRankingOptions(q);
      if (resolved.length === 0) continue;
      const positions = Math.max(1, q.rankingConfig?.positions ?? 3);
      const valuePairs = toSpssValueLabelPairs(resolved)
        .map((p) => `${p.code} '${esc(p.label)}'`)
        .join(' ');
      if (valuePairs.length === 0) continue;
      const varNames = Array.from(
        { length: positions },
        (_, k) => `${q.questionCode}_rk${k + 1}`,
      ).join(' ');
      entries.push(`  ${varNames} ${valuePairs}`);
      continue;
    }

    if (!q.questionCode || !q.options || q.options.length === 0) continue;

    if (q.type === 'radio' || q.type === 'select') {
      const valuePairs = q.options
        .map((opt, idx) => {
          const code = opt.spssNumericCode ?? idx + 1;
          return `${code} '${esc(opt.label)}'`;
        })
        .join(' ');
      entries.push(`  ${q.questionCode} ${valuePairs}`);
    } else if (q.type === 'checkbox') {
      for (let i = 0; i < q.options.length; i++) {
        const opt = q.options[i];
        const code = opt.spssNumericCode ?? i + 1;
        entries.push(`  ${q.questionCode}_${opt.optionCode ?? String(i + 1)} ${code} '선택'`);
      }
    }
  }

  // table 질문의 Case 3 ranking 셀 value labels (별도 루프)
  for (const q of questions) {
    if (q.type !== 'table') continue;
    for (const info of collectTableRankingCells(q)) {
      if (info.options.length === 0) continue;
      const valuePairs = info.options
        .map((opt, idx) => {
          const code = opt.spssNumericCode ?? idx + 1;
          return `${code} '${esc(opt.label)}'`;
        })
        .join(' ');
      const varNames = Array.from(
        { length: info.positions },
        (_, k) => resolveRankVarName(info.baseVarName, info.suffixPattern, info.varNameOverrides, k + 1),
      ).join(' ');
      entries.push(`  ${varNames} ${valuePairs}`);
    }
  }

  if (entries.length === 0) return '';
  return `* 값 라벨 설정.\nVALUE LABELS\n${entries.join(' /\n')}.`;
}

/**
 * VARIABLE LEVEL 신택스를 생성한다.
 * - radio, select, checkbox → NOMINAL
 * - text, textarea, multiselect → SCALE
 */
export function generateVariableLevel(questions: Question[]): string {
  const nominal: string[] = [];
  const ordinal: string[] = [];
  const scale: string[] = [];

  for (const q of questions) {
    // notice 동의 → NOMINAL, 날짜 → SCALE
    if (q.type === 'notice') {
      if (q.requiresAcknowledgment && q.questionCode) {
        nominal.push(q.questionCode);
        scale.push(`${q.questionCode}_DATE`);
      }
      continue;
    }
    if (!q.questionCode) continue;

    if (q.type === 'radio' || q.type === 'select') {
      nominal.push(q.questionCode);
      // allowTextInput 옵션 텍스트 변수 → NOMINAL (STRING 변수는 NOMINAL)
      for (const v of generateOptionTextVariables(q)) {
        nominal.push(v.name);
      }
    } else if (q.type === 'checkbox' && q.options) {
      for (let i = 0; i < q.options.length; i++) {
        const opt = q.options[i];
        nominal.push(`${q.questionCode}_${opt.optionCode ?? String(i + 1)}`);
        // allowTextInput 옵션 텍스트 변수 → NOMINAL (STRING 변수는 NOMINAL)
        if (opt.allowTextInput) {
          const varNumber = opt.optionCode ?? String(i + 1);
          nominal.push(buildOptionTextVarName(q.questionCode, varNumber));
        }
      }
    } else if (q.type === 'ranking') {
      // Case 1/2 공통 변수 레벨
      const positions = Math.max(1, q.rankingConfig?.positions ?? 3);
      const needsOtherColumn = q.allowOtherOption || hasOtherRankingCell(q);
      for (let k = 1; k <= positions; k++) {
        ordinal.push(`${q.questionCode}_rk${k}`);
        if (needsOtherColumn) {
          scale.push(`${q.questionCode}_rk${k}_etc`);
        }
      }
    } else if (q.type === 'table') {
      // table 질문의 Case 3 ranking 셀: _rk{k} → ORDINAL, _rk{k}_etc → SCALE (접미사 셀별 설정 반영)
      for (const info of collectTableRankingCells(q)) {
        for (let k = 1; k <= info.positions; k++) {
          const rankVar = resolveRankVarName(info.baseVarName, info.suffixPattern, info.varNameOverrides, k);
          ordinal.push(rankVar);
          if (info.allowOther) {
            scale.push(`${rankVar}_etc`);
          }
        }
      }
      // 테이블 셀의 allowTextInput 옵션 텍스트 변수 → NOMINAL (STRING 변수는 NOMINAL)
      if (q.tableRowsData && q.tableColumns) {
        for (const tRow of q.tableRowsData) {
          for (let colIdx = 0; colIdx < q.tableColumns.length; colIdx++) {
            const cell = tRow.cells[colIdx];
            if (!cell) continue;
            if (cell.isCustomCellCode === true && !cell.cellCode) continue;
            const cellVarName = cell.cellCode
              || buildTableCellVarName(q, tRow, colIdx, q.tableColumns, q.tableRowsData!);
            const cellOpts =
              cell.type === 'checkbox' ? cell.checkboxOptions
              : cell.type === 'radio' ? cell.radioOptions
              : cell.type === 'select' ? cell.selectOptions
              : undefined;
            if (!cellOpts) continue;
            for (const v of generateCellOptionTextVariables(cellVarName, q.title, cellOpts)) {
              nominal.push(v.name);
            }
          }
        }
      }
    } else {
      scale.push(q.questionCode);
    }
  }

  const parts: string[] = [];
  if (nominal.length > 0) {
    parts.push(`  ${nominal.join(' ')} (NOMINAL)`);
  }
  if (ordinal.length > 0) {
    parts.push(`  ${ordinal.join(' ')} (ORDINAL)`);
  }
  if (scale.length > 0) {
    parts.push(`  ${scale.join(' ')} (SCALE)`);
  }

  if (parts.length === 0) return '';
  return `* 측정 수준 설정.\nVARIABLE LEVEL\n${parts.join(' /\n')}.`;
}

/**
 * MRSETS 신택스를 생성한다. (복수응답 세트)
 * - checkbox 질문만 해당
 */
export function generateMrsets(questions: Question[]): string {
  const sets: string[] = [];

  for (const q of questions) {
    if (q.type !== 'checkbox' || !q.questionCode) continue;

    // 테이블 소스(choice_opt 셀) checkbox 는 q.options 가 비어 있으므로 resolveChoiceOptions 로 통합 조회.
    const options = resolveChoiceOptions(q);
    if (options.length === 0) continue;

    const vars = options.map((opt, i) => `${q.questionCode}_${opt.optionCode ?? String(i + 1)}`).join(' ');
    sets.push(`  /MCGROUP NAME=$${q.questionCode} LABEL='${esc(q.title)}' VARIABLES=${vars}`);
  }

  if (sets.length === 0) return '';
  return `* 복수응답 세트 정의.\nMRSETS\n${sets.join('\n')}.`;
}

/**
 * 전체 SPSS 신택스 파일(.sps) 내용을 생성한다.
 */
export function generateFullSyntax(questions: Question[]): string {
  const sections = [
    generateVariableLabels(questions),
    generateValueLabels(questions),
    generateVariableLevel(questions),
    generateMrsets(questions),
  ].filter((s) => s.length > 0);

  return sections.join('\n\n') + '\n';
}
