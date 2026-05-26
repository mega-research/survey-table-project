import { describe, it, expect } from 'vitest';
import type { Question } from '@/types/survey';
import { detectCellTypeKind } from '@/utils/cell-type-detector';

type TableRowData = NonNullable<Question['tableRowsData']>[number];
type TableCellData = TableRowData['cells'][number];

function makeQuestion(
  rows: Array<{ id: string; cells: Array<Partial<TableCellData>> }>,
): Question {
  return {
    id: 'q1',
    surveyId: 's1',
    type: 'table',
    title: 't',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'c0', label: '0' },
      { id: 'c1', label: '1' },
    ],
    tableRowsData: rows.map((r) => ({
      id: r.id,
      label: r.id,
      cells: r.cells.map((c, i) => ({
        id: `${r.id}-${i}`,
        content: '',
        type: 'text' as const,
        ...c,
      })),
    })),
  } as unknown as Question;
}

describe('detectCellTypeKind', () => {
  it('단일 행, number input 셀 → numeric-input', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'input', inputType: 'number' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1'], 1)).toBe('numeric-input');
  });

  it('단일 행, text input 셀 → text-input', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'input', inputType: 'text' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1'], 1)).toBe('text-input');
  });

  it('단일 행, inputType 미지정 input → text-input', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'input' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1'], 1)).toBe('text-input');
  });

  it('단일 행, radio 셀 → option', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'radio' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1'], 1)).toBe('option');
  });

  it('단일 행, checkbox 셀 → option', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'checkbox' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1'], 1)).toBe('option');
  });

  it('단일 행, select 셀 → option', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'select' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1'], 1)).toBe('option');
  });

  it('단일 행, image 셀 → unsupported', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'image' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1'], 1)).toBe('unsupported');
  });

  it('단일 행, ranking 셀 → unsupported', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'ranking' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1'], 1)).toBe('unsupported');
  });

  it('두 행, 같은 column 둘 다 number input → numeric-input', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'input', inputType: 'number' }] },
      { id: 'r2', cells: [{ type: 'text' }, { type: 'input', inputType: 'number' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1', 'r2'], 1)).toBe('numeric-input');
  });

  it('두 행, 같은 column 이지만 종류가 섞임 → mixed', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'input', inputType: 'number' }] },
      { id: 'r2', cells: [{ type: 'text' }, { type: 'radio' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1', 'r2'], 1)).toBe('mixed');
  });

  it('두 행, number input 과 text input 섞임 → mixed', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'input', inputType: 'number' }] },
      { id: 'r2', cells: [{ type: 'text' }, { type: 'input', inputType: 'text' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1', 'r2'], 1)).toBe('mixed');
  });

  it('question 이 undefined → unsupported', () => {
    expect(detectCellTypeKind(undefined, ['r1'], 1)).toBe('unsupported');
  });

  it('rowIds 가 비어있음 → unsupported', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'input', inputType: 'number' }] },
    ]);
    expect(detectCellTypeKind(q, [], 1)).toBe('unsupported');
  });

  it('colIndex 가 undefined → unsupported', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'input', inputType: 'number' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1'], undefined)).toBe('unsupported');
  });

  it('존재하지 않는 rowId → unsupported', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'input', inputType: 'number' }] },
    ]);
    expect(detectCellTypeKind(q, ['ghost'], 1)).toBe('unsupported');
  });

  it('colIndex 가 범위 밖 → unsupported', () => {
    const q = makeQuestion([
      { id: 'r1', cells: [{ type: 'text' }, { type: 'input', inputType: 'number' }] },
    ]);
    expect(detectCellTypeKind(q, ['r1'], 99)).toBe('unsupported');
  });
});
