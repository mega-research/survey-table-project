import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import type { Question, TableCell } from '@/types/survey';

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

interface MrsetEntry {
  // $ 제외한 세트 이름 (변수명 규칙 준수)
  name: string;
  label: string;
  variables: string[];
}

/**
 * 복수응답 세트(.sps MRSETS/MCGROUP) 문법을 생성한다.
 * - .sav 바이너리에는 MRSET을 쓸 수 없어(sav-writer 미지원) 보조 문법 파일로 제공.
 * - 변수명은 generateSPSSColumns 출력에서 가져온다 — export와 단일 진실.
 * - checkbox export는 counted value(카테고리) 방식이므로 MCGROUP을 쓴다.
 * - 세트가 하나도 없으면 null.
 */
export function generateMrsetsSyntax(
  columns: SPSSExportColumn[],
  questions: Question[],
): string | null {
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
      label: cell.exportLabel ?? cell.cellCode,
      variables: cols.map((c) => c.spssVarName),
    });
  }

  if (entries.length === 0) return null;

  const lines = entries.map(
    (e) =>
      `  /MCGROUP NAME=$${e.name} LABEL='${escapeSpsLabel(e.label)}' VARIABLES=${e.variables.join(' ')}`,
  );
  return [
    '* 복수응답 세트 정의 - .sav 파일을 연 뒤 이 문법을 실행하세요.',
    'MRSETS',
    `${lines.join('\n')}.`,
    '',
  ].join('\n');
}
