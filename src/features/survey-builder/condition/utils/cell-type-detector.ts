import type { Question } from '@/types/survey';

export type CellTypeKind =
  | 'numeric-input'
  | 'text-input'
  | 'option'
  | 'mixed'
  | 'unsupported';

function classifySingleCell(
  question: Question,
  rowId: string,
  colIndex: number,
): CellTypeKind {
  const row = question.tableRowsData?.find((r) => r.id === rowId);
  if (!row) return 'unsupported';
  const cell = row.cells?.[colIndex];
  if (!cell) return 'unsupported';
  if (cell.type === 'input') {
    return cell.inputType === 'number' ? 'numeric-input' : 'text-input';
  }
  if (cell.type === 'radio' || cell.type === 'checkbox' || cell.type === 'select') {
    return 'option';
  }
  return 'unsupported';
}

/**
 * 선택된 행 그룹의 column 셀 타입을 분류한다.
 * 모든 행에서 동일 종류여야 그 종류, 아니면 'mixed'.
 *
 * 입력 가드:
 * - question 이 없거나 rowIds 가 비어있거나 colIndex 미지정 → 'unsupported'
 * - 행/셀이 존재하지 않거나 분류 불가 셀(image, video, text, ranking 등) 포함 → 'unsupported'
 */
export function detectCellTypeKind(
  question: Question | undefined,
  rowIds: string[],
  colIndex: number | undefined,
): CellTypeKind {
  if (!question) return 'unsupported';
  if (rowIds.length === 0) return 'unsupported';
  if (colIndex === undefined) return 'unsupported';

  let first: CellTypeKind | null = null;
  for (const rid of rowIds) {
    const k = classifySingleCell(question, rid, colIndex);
    if (k === 'unsupported') return 'unsupported';
    if (first === null) {
      first = k;
      continue;
    }
    if (k !== first) return 'mixed';
  }
  return first ?? 'unsupported';
}

/** 값 비교 UI 를 켤 수 있는 셀 종류인지 판정. */
export function isValueComparableKind(kind: CellTypeKind): boolean {
  return kind === 'numeric-input' || kind === 'option';
}
