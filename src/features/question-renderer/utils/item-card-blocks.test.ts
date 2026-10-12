import { describe, expect, it } from 'vitest';

import type { TableCell, TableColumn, TableRow } from '@/types/survey';

import {
  buildItemCardBlocks,
  normalizeItemCardBlockColumns,
  parseItemCardBlockColumnsText,
} from './item-card-blocks';
import { itemCardTitleText } from './item-cards';

const text = (id: string, content: string, o: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'text',
  content,
  ...o,
});
const input = (id: string): TableCell => ({ id, type: 'input', content: '' });
const calc = (id: string): TableCell => ({ id, type: 'calc', content: '' });

// 학력별 | 경력별 — 블록마다 [들여쓰기, 라벨, 현재, 부족, 채용] 5열
const columns: TableColumn[] = [
  '24-1) 학력별 인력 수',
  '',
  '현재 인력',
  '부족 인력',
  '채용 예정',
  '24-2) 경력별 인력 수',
  '',
  '현재 인력',
  '부족 인력',
  '채용 예정',
].map((label, index) => ({ id: `c${index + 1}`, label }) as TableColumn);

const totalRow: TableRow = {
  id: 'total',
  label: '합계',
  cells: [
    text('e-total', '학력 합계', { colspan: 2 }),
    text('e-total-x', '', { isHidden: true }),
    calc('e-t1'),
    calc('e-t2'),
    calc('e-t3'),
    text('c-total', '경력 합계', { colspan: 2 }),
    text('c-total-x', '', { isHidden: true }),
    calc('c-t1'),
    calc('c-t2'),
    calc('c-t3'),
  ],
};
const itemRow = (n: number, first: boolean): TableRow => ({
  id: `r${n}`,
  label: `행 ${n}`,
  cells: [
    first ? text('e-indent', '', { rowspan: 2 }) : text(`e-indent-${n}`, '', { isHidden: true }),
    text(`e-l${n}`, `학력 ${n}`),
    input(`e-${n}-1`),
    input(`e-${n}-2`),
    input(`e-${n}-3`),
    first ? text('c-indent', '', { rowspan: 2 }) : text(`c-indent-${n}`, '', { isHidden: true }),
    text(`c-l${n}`, `경력 ${n}`),
    input(`c-${n}-1`),
    input(`c-${n}-2`),
    input(`c-${n}-3`),
  ],
});
const rows = [totalRow, itemRow(1, true), itemRow(2, false)];

const titles = (cards: { titleCells: TableCell[] }[]) =>
  cards.map((card) => card.titleCells.map(itemCardTitleText).join(' > '));

describe('buildItemCardBlocks', () => {
  it('블록 시작 열이 없으면 null — 종전 항목 단위 카드', () => {
    expect(
      buildItemCardBlocks({
        authoredColumns: columns,
        visibleColumns: columns,
        displayRows: rows,
        blockStartColumns: null,
      }),
    ).toBeNull();
  });

  it('블록마다 항목을 끝까지 세우고, 계산 칸만 있는 행은 머리 요약으로 올린다', () => {
    const result = buildItemCardBlocks({
      authoredColumns: columns,
      visibleColumns: columns,
      displayRows: rows,
      blockStartColumns: [6],
    })!;
    expect(result.blocks.map((block) => block.title)).toEqual([
      '24-1) 학력별 인력 수',
      '24-2) 경력별 인력 수',
    ]);
    expect(titles(result.blocks[0]!.cards)).toEqual(['학력 1', '학력 2']);
    expect(titles(result.blocks[1]!.cards)).toEqual(['경력 1', '경력 2']);
    expect(titles(result.blocks[0]!.summaries)).toEqual(['학력 합계']);
    expect(result.blocks[1]!.summaries[0]!.inputs.map((entry) => entry.cell.id)).toEqual([
      'c-t1',
      'c-t2',
      'c-t3',
    ]);
    expect(result.blocks[1]!.cards[0]!.inputs.map((entry) => entry.cell.id)).toEqual([
      'c-1-1',
      'c-1-2',
      'c-1-3',
    ]);
  });

  it('입력 칸의 열 헤더를 라벨 폴백으로 내준다', () => {
    const result = buildItemCardBlocks({
      authoredColumns: columns,
      visibleColumns: columns,
      displayRows: rows,
      blockStartColumns: [1, 6],
    })!;
    const entry = result.blocks[1]!.cards[0]!.inputs[1]!;
    expect(result.columnLabels[entry.columnIndex]).toBe('부족 인력');
  });

  it('열이 숨어도 작성 열 번호 기준으로 블록을 가른다', () => {
    const visible = columns.filter((column) => column.id !== 'c3');
    const displayRows = rows.map((row) => ({
      ...row,
      cells: row.cells.filter((_, index) => index !== 2),
    }));
    const result = buildItemCardBlocks({
      authoredColumns: columns,
      visibleColumns: visible,
      displayRows,
      blockStartColumns: [6],
    })!;
    expect(result.blocks[0]!.cards[0]!.inputs.map((entry) => entry.cell.id)).toEqual([
      'e-1-2',
      'e-1-3',
    ]);
    expect(titles(result.blocks[1]!.cards)).toEqual(['경력 1', '경력 2']);
  });
});

describe('블록 시작 열 입력', () => {
  it('1은 암묵이고 중복·순서를 정돈한다', () => {
    expect(normalizeItemCardBlockColumns([5, 5], 8)).toEqual([1, 5]);
    expect(normalizeItemCardBlockColumns([5, 1], 8)).toEqual([1, 5]);
    expect(normalizeItemCardBlockColumns([1], 8)).toEqual([1]);
    expect(normalizeItemCardBlockColumns([], 8)).toBeNull();
    expect(normalizeItemCardBlockColumns([99], 8)).toBeNull();
  });

  it('쉼표·공백으로 적은 글자를 읽고, 범위 밖·숫자 아님은 거부한다', () => {
    expect(parseItemCardBlockColumnsText('1,5', 8)).toEqual({ ok: true, value: [1, 5] });
    expect(parseItemCardBlockColumnsText(' 5 ', 8)).toEqual({ ok: true, value: [1, 5] });
    expect(parseItemCardBlockColumnsText('', 8)).toEqual({ ok: true, value: null });
    expect(parseItemCardBlockColumnsText('1,9', 8)).toEqual({ ok: false });
    expect(parseItemCardBlockColumnsText('a', 8)).toEqual({ ok: false });
  });
});
