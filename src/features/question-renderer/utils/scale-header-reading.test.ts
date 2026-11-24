import { describe, expect, it } from 'vitest';

import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import {
  isNumberMarkLabel,
  isScaleVisibleCell,
  locateScaleColumnRun,
  readScaleHeader,
} from './scale-header-reading';

/**
 * 척도 줄의 헤더 읽기 코어 — 눈금 수 상한도, 칸 이름을 싣는 방식(칸 안 라벨·이름 목록)도 모른다.
 * 척도 막대 투영의 결과는 옆 파일(choice-group-scale-bar.test.ts)이 그대로 지킨다.
 */

const head = (id: string, label: string, colspan: number, rowspan = 1): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan,
});
const choiceCells = (contents: readonly string[]): TableCell[] =>
  contents.map((content, n) => ({ id: `c${n}`, type: 'choice_opt', content }));
const rowOf = (cells: TableCell[]): TableRow => ({
  id: 'r1',
  label: '항목',
  cells: [{ id: 'item', type: 'text', content: '항목' }, ...cells],
});
const columnsOf = (labels: readonly string[]): TableColumn[] => [
  { id: 'item', label: '항목' },
  ...labels.map((label, n) => ({ id: `s${n}`, label })),
];
const blank = (count: number): string[] => Array.from({ length: count }, () => '');

const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'];
const FIVE_NAMES = ['전혀 그렇지 않다', '그렇지 않다', '보통', '그렇다', '매우 그렇다'];
const SEVEN_NAMES = [
  '전혀 아니다',
  '아니다',
  '약간 아니다',
  '보통',
  '약간 그렇다',
  '그렇다',
  '매우 그렇다',
];
const THIRTEEN_NAMES = CIRC.map((_, n) => `수준 ${String.fromCharCode(0xac00 + n)}`);

/** 대상 칸이 첫 글자 열 바로 뒤(열 1)부터 이어진 표를 읽는다 */
function read(cells: TableCell[], columns: TableColumn[], headerGrid?: HeaderCell[][]) {
  return readScaleHeader({ columns, headerGrid, first: 1, targetCells: cells });
}

describe('readScaleHeader — 칸 글자 · 칸 이름 · 구간', () => {
  it('5칸 — 이름 줄과 번호 줄이 함께 있으면 번호가 칸 글자, 이름이 칸 이름이다', () => {
    const cells = choiceCells(blank(5));
    const reading = read(cells, columnsOf(blank(5)), [
      [head('h-item', '항목', 1, 2), ...FIVE_NAMES.map((name, n) => head(`h-n${n}`, name, 1))],
      CIRC.slice(1, 6).map((mark, n) => head(`h-m${n}`, mark, 1)),
    ]);
    expect(reading).toEqual({
      cells: FIVE_NAMES.map((name, n) => ({
        cellId: `c${n}`,
        text: CIRC[n + 1],
        name,
        bandIndex: null,
      })),
      bands: [],
    });
  });

  it('7칸 — 여러 칸을 묶은 머리는 구간이고 칸마다 제 구간을 가리킨다', () => {
    const cells = choiceCells(CIRC.slice(1, 8));
    const reading = read(cells, columnsOf(blank(7)), [
      [
        head('h-item', '항목', 1),
        head('h-lo', '전혀 필요 없음', 3),
        head('h-mid', '보통', 1),
        head('h-hi', '매우 필요함', 3),
      ],
    ]);
    expect(reading?.bands).toEqual([
      { label: '전혀 필요 없음', start: 0, span: 3 },
      { label: '보통', start: 3, span: 1 },
      { label: '매우 필요함', start: 4, span: 3 },
    ]);
    expect(reading?.cells.map((cell) => cell.text)).toEqual(CIRC.slice(1, 8));
    expect(reading?.cells.map((cell) => cell.bandIndex)).toEqual([0, 0, 0, 1, 2, 2, 2]);
    expect(reading?.cells.every((cell) => cell.name === undefined)).toBe(true);
  });

  it('7칸 — 칸 이름과 구간이 함께 있으면 둘 다 싣는다(6칸 이상이어도 이름을 버리지 않는다)', () => {
    const cells = choiceCells(CIRC.slice(1, 8));
    const reading = read(cells, columnsOf(blank(7)), [
      [
        head('h-item', '항목', 1, 2),
        head('h-neg', '부정', 3),
        head('h-mid', '중립', 1),
        head('h-pos', '긍정', 3),
      ],
      SEVEN_NAMES.map((name, n) => head(`h-n${n}`, name, 1)),
    ]);
    expect(reading?.cells.map((cell) => cell.name)).toEqual(SEVEN_NAMES);
    expect(reading?.cells.map((cell) => cell.text)).toEqual(CIRC.slice(1, 8));
    expect(reading?.bands.map((band) => band.label)).toEqual(['부정', '중립', '긍정']);
    expect(reading?.cells.map((cell) => cell.bandIndex)).toEqual([0, 0, 0, 1, 2, 2, 2]);
  });

  it('13칸 — 다단 헤더 없이 열 제목에만 이름이 있어도 칸마다 이름을 읽는다', () => {
    const cells = choiceCells(CIRC);
    const reading = read(cells, columnsOf(THIRTEEN_NAMES));
    expect(reading?.cells).toHaveLength(13);
    expect(reading?.cells.map((cell) => cell.text)).toEqual(CIRC);
    expect(reading?.cells.map((cell) => cell.name)).toEqual(THIRTEEN_NAMES);
    expect(reading?.bands).toEqual([]);
  });

  it('13칸 — 구간 셋이 덮는 칸 수와 함께 실린다', () => {
    const cells = choiceCells(CIRC);
    const reading = read(cells, columnsOf(blank(13)), [
      [
        head('h-item', '항목', 1),
        head('h-neg', '불만족', 6),
        head('h-mid', '보통', 1),
        head('h-pos', '만족', 6),
      ],
    ]);
    expect(reading?.bands).toEqual([
      { label: '불만족', start: 0, span: 6 },
      { label: '보통', start: 6, span: 1 },
      { label: '만족', start: 7, span: 6 },
    ]);
    expect(reading?.cells.map((cell) => cell.bandIndex)).toEqual([
      0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2,
    ]);
  });

  it('대상 열 전체를 덮는 제목 줄은 버린다', () => {
    const cells = choiceCells(blank(5));
    const reading = read(cells, columnsOf(blank(5)), [
      [head('h-item', '항목', 1, 2), head('h-title', '만족도', 5)],
      CIRC.slice(1, 6).map((mark, n) => head(`h-m${n}`, mark, 1)),
    ]);
    expect(reading?.bands).toEqual([]);
    expect(reading?.cells.map((cell) => cell.text)).toEqual(CIRC.slice(1, 6));
    expect(reading?.cells.every((cell) => cell.name === undefined)).toBe(true);
  });

  it('칸 글자와 같거나 번호뿐인 머리는 칸 이름이 아니다', () => {
    const sameAsText = read(choiceCells(FIVE_NAMES), columnsOf(FIVE_NAMES));
    expect(sameAsText?.cells.map((cell) => cell.text)).toEqual(FIVE_NAMES);
    expect(sameAsText?.cells.every((cell) => cell.name === undefined)).toBe(true);

    const numbered = read(
      choiceCells(CIRC.slice(1, 6)),
      columnsOf(['1점', '2점', '3점', '4점', '5점']),
    );
    expect(numbered?.cells.every((cell) => cell.name === undefined)).toBe(true);
  });

  it('글자가 빈 칸을 그 칸만 덮는 한 칸짜리 머리가 덮으면 그 이름이 칸 글자가 되고 구간에서 빠진다', () => {
    const cells = choiceCells([...CIRC.slice(1, 5), '']);
    const reading = read(cells, columnsOf(blank(5)), [
      [
        head('h-item', '항목', 1),
        head('h-lo', '전혀', 2),
        head('h-hi', '매우', 2),
        head('h-out', '미참여', 1),
      ],
    ]);
    expect(reading?.cells.map((cell) => cell.text)).toEqual([...CIRC.slice(1, 5), '미참여']);
    expect(reading?.bands).toEqual([
      { label: '전혀', start: 0, span: 2 },
      { label: '매우', start: 2, span: 2 },
    ]);
    expect(reading?.cells.map((cell) => cell.bandIndex)).toEqual([0, 0, 1, 1, null]);
  });

  it('머리와 칸 글자의 줄바꿈·앞뒤 공백은 한 칸 공백으로 잇는다', () => {
    const cells = choiceCells([' ① ', '②', '③']);
    const reading = read(cells, columnsOf(blank(3)), [
      [head('h-item', '항목', 1), head('h-lo', '전혀\n그렇지\n않다', 2), head('h-hi', '매우\n그렇다', 1)],
    ]);
    expect(reading?.cells.map((cell) => cell.text)).toEqual(['①', '②', '③']);
    expect(reading?.bands.map((band) => band.label)).toEqual(['전혀 그렇지 않다', '매우 그렇다']);
  });

  it('칸 글자를 어디서도 읽을 수 없으면 null', () => {
    const cells = choiceCells(blank(5));
    expect(
      read(cells, columnsOf(blank(5)), [
        [head('h-item', '항목', 1), head('h-lo', '전혀', 2), head('h-hi', '매우', 3)],
      ]),
    ).toBeNull();
    expect(read(cells, columnsOf(blank(5)))).toBeNull();
  });
});

describe('locateScaleColumnRun — 대상 칸이 선 열', () => {
  const cells = choiceCells(CIRC.slice(1, 6));

  it('이어진 칸이면 첫 칸의 열 자리를 돌려준다', () => {
    expect(locateScaleColumnRun({ row: rowOf(cells), columnCount: 6, targetCells: cells })).toEqual({
      ok: true,
      first: 1,
    });
  });

  it('13칸이든 한 칸이든 칸 수는 따지지 않는다', () => {
    const thirteen = choiceCells(CIRC);
    expect(
      locateScaleColumnRun({ row: rowOf(thirteen), columnCount: 14, targetCells: thirteen }),
    ).toEqual({ ok: true, first: 1 });
    expect(
      locateScaleColumnRun({ row: rowOf(cells), columnCount: 6, targetCells: [cells[2]!] }),
    ).toEqual({ ok: true, first: 3 });
  });

  it('사이에 입력칸이 끼면 「보기 칸이 아닌 칸이 섞였다」', () => {
    const input: TableCell = { id: 'memo', type: 'input', content: '' };
    const row = rowOf([cells[0]!, cells[1]!, input, cells[2]!, cells[3]!, cells[4]!]);
    expect(locateScaleColumnRun({ row, columnCount: 7, targetCells: cells })).toEqual({
      ok: false,
      reason: 'non-choice-cell',
    });
  });

  it('사이에 대상이 아닌 보기 칸·숨은 칸이 끼면 비연속', () => {
    const other: TableCell = { id: 'other', type: 'choice_opt', content: '모름' };
    const withOther = rowOf([cells[0]!, cells[1]!, other, cells[2]!, cells[3]!, cells[4]!]);
    expect(locateScaleColumnRun({ row: withOther, columnCount: 7, targetCells: cells })).toEqual({
      ok: false,
      reason: 'non-contiguous',
    });
    const hidden: TableCell = { id: 'hidden', type: 'input', content: '', isHidden: true };
    const withHidden = rowOf([cells[0]!, hidden, ...cells.slice(1)]);
    expect(locateScaleColumnRun({ row: withHidden, columnCount: 7, targetCells: cells })).toEqual({
      ok: false,
      reason: 'non-contiguous',
    });
  });

  it('행에 없는 칸·열 밖의 칸이 대상이면 비연속', () => {
    const stranger: TableCell = { id: 'stranger', type: 'choice_opt', content: '①' };
    expect(
      locateScaleColumnRun({ row: rowOf(cells), columnCount: 6, targetCells: [stranger] }),
    ).toEqual({ ok: false, reason: 'non-contiguous' });
    expect(locateScaleColumnRun({ row: rowOf(cells), columnCount: 3, targetCells: cells })).toEqual({
      ok: false,
      reason: 'non-contiguous',
    });
  });
});

describe('isScaleVisibleCell · isNumberMarkLabel', () => {
  it('숨김·병합으로 이어진 칸은 없는 칸이다', () => {
    expect(isScaleVisibleCell({ id: 'a', type: 'choice_opt', content: '①' })).toBe(true);
    expect(isScaleVisibleCell({ id: 'a', type: 'choice_opt', content: '①', isHidden: true })).toBe(
      false,
    );
    expect(
      isScaleVisibleCell({ id: 'a', type: 'choice_opt', content: '①', _isContinuation: true }),
    ).toBe(false);
  });

  it('번호뿐인 글자는 이름이 아니라 칸 번호다', () => {
    for (const mark of ['4', '④', '❹', '4점', '(4)', '１０']) {
      expect(isNumberMarkLabel(mark)).toBe(true);
    }
    for (const name of ['보통', '4점 만족', '모름', 'N/A', '']) {
      expect(isNumberMarkLabel(name)).toBe(false);
    }
  });
});
