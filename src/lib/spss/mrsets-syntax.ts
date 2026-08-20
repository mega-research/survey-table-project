import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { resolveSpssDisplayFormat } from '@/lib/spss/export-metadata';
import type { Question, TableCell } from '@/types/survey';
import { DEFAULT_GROUP_KEY } from '@/utils/choice-group-helpers';
import { resolveChoiceOptions } from '@/utils/choice-source';

/** 질문의 tableRowsData에서 셀 id로 셀을 찾는다 */
function findTableCellById(question: Question | undefined, cellId: string): TableCell | undefined {
  if (!question?.tableRowsData) return undefined;
  for (const row of question.tableRowsData) {
    for (const cell of row.cells) {
      if (cell.id === cellId) return cell;
    }
  }
  return undefined;
}

/** SPSS 문법 문자열 리터럴 escape: 작은따옴표 이중화 */
function escapeSpsLabel(label: string): string {
  return label.replace(/'/g, "''");
}

export interface MrsetEntry {
  // $ 제외한 세트 이름 (변수명 규칙 준수)
  name: string;
  label: string;
  variables: string[];
  categories: Array<{ value: number; label: string }>;
}

function categoriesFromColumns(
  cols: SPSSExportColumn[],
  question: Question | undefined,
): Array<{ value: number; label: string }> {
  const byValue = new Map<number, string>();
  const questionOptions = question ? resolveChoiceOptions(question) : [];

  for (const col of cols) {
    let value: number | undefined;
    let label = col.optionLabel;
    if (col.type === 'choice-group-item') {
      value = col.choiceGroupMemberCode;
    } else if (col.optionIndex != null) {
      const option = col.cellOptions?.[col.optionIndex] ?? questionOptions[col.optionIndex];
      value = option?.spssNumericCode ?? col.optionIndex + 1;
      label = option?.label ?? label;
    }
    if (value !== undefined && !byValue.has(value)) byValue.set(value, label);
  }

  return [...byValue].map(([value, label]) => ({ value, label })).sort((a, b) => a.value - b.value);
}

/**
 * SPSS 보조 문법에 필요한 복수응답 세트 정의를 만든다.
 * - .sav 바이너리에는 MRSET을 쓸 수 없어(sav-writer 미지원) 보조 문법 파일로 제공.
 * - 변수명은 generateSPSSColumns 출력에서 가져온다 — export와 단일 진실.
 * - checkbox export는 counted value(카테고리) 방식이므로 MCGROUP을 쓴다.
 */
export function buildMrsetEntries(
  columns: SPSSExportColumn[],
  questions: Question[],
): MrsetEntry[] {
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const entries: MrsetEntry[] = [];

  // 질문 단위: checkbox-item 컬럼을 questionId로 그룹화
  const byQuestion = new Map<string, SPSSExportColumn[]>();
  for (const col of columns) {
    if (col.type !== 'checkbox-item') continue;
    const list = byQuestion.get(col.questionId) ?? [];
    list.push(col);
    byQuestion.set(col.questionId, list);
  }

  for (const [questionId, cols] of byQuestion) {
    const question = questionMap.get(questionId);
    if (!question?.questionCode) continue;
    entries.push({
      name: question.questionCode,
      label: question.exportLabel || question.title,
      variables: cols.map((c) => c.spssVarName),
      categories: categoriesFromColumns(cols, question),
    });
  }

  // 테이블 checkbox 셀 단위: 셀 하나 = 복수응답 세트 하나
  const byCell = new Map<string, SPSSExportColumn[]>();
  for (const col of columns) {
    if (col.type !== 'table-cell' || col.tableCellType !== 'checkbox') continue;
    if (!col.tableCellId) continue;
    const list = byCell.get(col.tableCellId) ?? [];
    list.push(col);
    byCell.set(col.tableCellId, list);
  }
  for (const [cellId, cols] of byCell) {
    const first = cols[0];
    if (!first) continue;
    const question = questionMap.get(first.questionId);
    const cell = findTableCellById(question, cellId);
    if (!cell?.cellCode) continue;
    entries.push({
      name: cell.cellCode,
      label: cell.exportLabel || cell.cellCode,
      variables: cols.map((c) => c.spssVarName),
      categories: categoriesFromColumns(cols, question),
    });
  }

  // choice-group-item: (questionId, choiceGroupKey) 로 묶어 MCGROUP 생성.
  // 그룹 라벨은 컬럼의 optionLabel 에서 추출한다 — generateSPSSColumns 에서
  // optionLabel = "그룹라벨 - 보기라벨" 형식으로 설정되어 있으므로,
  // 첫 번째 멤버의 optionLabel 을 파싱하는 대신 question.choiceGroups 에서 직접 lookup 한다.
  // 세트명: default 그룹이면 $질문코드_default, 명시 그룹이면 $질문코드_groupKey.
  type CgiGroupKey = `${string}::${string}`; // questionId::groupKey
  const byCgiGroup = new Map<CgiGroupKey, SPSSExportColumn[]>();
  for (const col of columns) {
    if (col.type !== 'choice-group-item') continue;
    if (!col.choiceGroupKey) continue;
    const key: CgiGroupKey = `${col.questionId}::${col.choiceGroupKey}`;
    const list = byCgiGroup.get(key) ?? [];
    list.push(col);
    byCgiGroup.set(key, list);
  }

  for (const [key, cols] of byCgiGroup) {
    const [questionId, groupKey] = key.split('::') as [string, string];
    const question = questionMap.get(questionId);
    if (!question?.questionCode) continue;
    // MCGROUP 세트명: 명시 그룹은 questionCode_groupKey. default 그룹(미소속 셀)은
    // 그룹 도입 전과 동일한 questionCode — 변수명(Q8_1...)과 마찬가지로 하위호환 유지.
    // (그룹 있는 질문은 checkbox-item 을 emit 하지 않으므로 질문 단위 세트와 충돌 없음)
    const setName =
      groupKey === DEFAULT_GROUP_KEY
        ? question.questionCode
        : `${question.questionCode}_${groupKey}`;
    // LABEL: question.choiceGroups 에서 그룹 라벨 lookup;
    // default 그룹이면 question.exportLabel || question.title 폴백
    let groupLabel: string;
    if (groupKey === DEFAULT_GROUP_KEY) {
      groupLabel = question.exportLabel || question.title;
    } else {
      const groupDef = (question.choiceGroups ?? []).find((g) => g.groupKey === groupKey);
      groupLabel = groupDef?.label || question.exportLabel || question.title;
    }
    entries.push({
      name: setName,
      label: groupLabel,
      variables: cols.map((c) => c.spssVarName),
      categories: categoriesFromColumns(cols, question),
    });
  }

  return entries;
}

export function buildMrsetNameMap(
  columns: SPSSExportColumn[],
  questions: Question[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const entry of buildMrsetEntries(columns, questions)) {
    for (const variable of entry.variables) names.set(variable, `$${entry.name}`);
  }
  return names;
}

export function generateMrsetsSyntax(
  columns: SPSSExportColumn[],
  questions: Question[],
): string | null {
  const entries = buildMrsetEntries(columns, questions);

  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const formatLines = columns.flatMap((col) => {
    const format = resolveSpssDisplayFormat(col, questionMap.get(col.questionId));
    return format.startsWith('COMMA') || format.startsWith('PCT')
      ? [`FORMATS ${col.spssVarName} (${format}).`]
      : [];
  });

  // MRSET 없이 FORMATS 만 있어도 파일은 유효하다 — 둘 다 없을 때만 생성 불가.
  if (entries.length === 0 && formatLines.length === 0) return null;

  // 카테고리가 빈 세트는 VALUE LABELS 를 emit 하면 종결 마침표 없는 불법 문법이 된다.
  const valueLabelBlocks = entries
    .filter((entry) => entry.categories.length > 0)
    .map((entry) => {
      const categories = entry.categories.map(
        (category, index) =>
          `  ${category.value} '${escapeSpsLabel(category.label)}'${index === entry.categories.length - 1 ? '.' : ''}`,
      );
      return [`VALUE LABELS ${entry.variables.join(' ')}`, ...categories].join('\n');
    });

  const lines = entries.map(
    (e) =>
      `  /MCGROUP NAME=$${e.name} LABEL='${escapeSpsLabel(e.label)}' VARIABLES=${e.variables.join(' ')}`,
  );
  const mrsetsBlock = entries.length > 0 ? ['MRSETS', `${lines.join('\n')}.`] : [];
  return [
    '* SPSS 표시 형식·복수응답 값 라벨·세트 정의 - .sav 파일을 연 뒤 실행하세요.',
    ...valueLabelBlocks,
    ...formatLines,
    ...mrsetsBlock,
    '',
  ].join('\n');
}
