import { describe, expect, it } from 'vitest';

import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { expandHeaderGrid } from './expand-header-grid';
import {
  type MobilePiece,
  arrangeMobilePiece,
  resolveHeaderOverflowDirections,
} from './mobile-piece-arrangement';

const col = (id: string, extra: Partial<TableColumn> = {}): TableColumn => ({
  id,
  label: id,
  width: 100,
  ...extra,
});
const head = (id: string, colspan = 1, extra: Partial<HeaderCell> = {}): HeaderCell => ({
  id,
  label: id,
  colspan,
  rowspan: 1,
  ...extra,
});
const choice = (id: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'choice_opt',
  content: id,
  ...extra,
});
const text = (id: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'text',
  content: id,
  ...extra,
});
const input = (id: string): TableCell => ({ id, type: 'input', content: '' });
const row = (id: string, cells: TableCell[]): TableRow => ({ id, label: id, cells });

const SCORES = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'];

/** 한 줄 척도 — ⓪ ~ ⑩ 열한 칸, 머리 1·3·3·3·1 (구간 사이 세로선 숨김) */
function scaleLine(): MobilePiece {
  return {
    columns: SCORES.map((id) => col(`c-${id}`)),
    headerGrid: [
      [
        head('부정', 1, { hideRightBorder: true }),
        head('점1', 3, { hideRightBorder: true }),
        head('보통', 3, { hideRightBorder: true }),
        head('점2', 3, { hideRightBorder: true }),
        head('긍정', 1),
      ],
    ],
    rows: [row('r1', SCORES.map((id) => choice(id)))],
    interactiveRowId: 'r1',
  };
}

/** 항목 표의 한 행 — 점수 열한 칸 + 끝의 「해당없음」(평균에서 제외), 머리 2·2·3·2·2·1 */
function matrixRow(): MobilePiece {
  return {
    columns: [...SCORES.map((id) => col(`c-${id}`)), col('c-na')],
    headerGrid: [
      [
        head('부정', 2, { hideRightBorder: true }),
        head('점1', 2, { hideRightBorder: true }),
        head('보통', 3, { hideRightBorder: true }),
        head('점2', 2, { hideRightBorder: true }),
        head('긍정', 2),
        head('해당없음', 1),
      ],
    ],
    rows: [row('r1', [...SCORES.map((id) => choice(id)), choice('na', { excludeFromMean: true })])],
    interactiveRowId: 'r1',
  };
}

const cellIds = (piece: MobilePiece, rowId = piece.interactiveRowId) =>
  piece.rows.find((r) => r.id === rowId)!.cells.map((cell) => cell.id);

/** 머리 격자가 그려지는 자리 — 「이름@시작열+폭」 */
const headerPlacement = (piece: MobilePiece) =>
  expandHeaderGrid(piece.headerGrid ?? []).map(
    ({ cell, startCol, colSpan }) => `${cell.id}@${startCol}+${colSpan}`,
  );

/** 머리 줄에서 세로선이 숨겨진 경계(그 왼쪽 열의 번호, 1부터) — 마지막 열의 끝선은 세지 않는다 */
function hiddenHeaderBoundaries(piece: MobilePiece): number[] {
  return expandHeaderGrid(piece.headerGrid ?? [])
    .filter(({ cell }) => cell.hideRightBorder === true)
    .map(({ startCol, colSpan }) => startCol + colSpan - 1)
    .filter((end) => end < piece.columns.length)
    .sort((a, b) => a - b);
}

describe('arrangeMobilePiece — 설정이 꺼져 있으면', () => {
  it('넣은 조각을 같은 참조로 돌려준다', () => {
    const piece = scaleLine();
    const off = arrangeMobilePiece(piece, {});
    expect(off.piece).toBe(piece);
    expect(off.reversed).toBe(false);
    expect(off.fit).toBeNull();
    expect(off.reverseFallback).toBeNull();
    expect(off.fitFallback).toBeNull();

    expect(arrangeMobilePiece(piece, { reverseColumns: false, columnsPerView: null }).piece).toBe(
      piece,
    );
  });
});

describe('arrangeMobilePiece — 좌우 반전', () => {
  it('한 줄 척도 열한 칸이 작성 순서의 반대로 선다', () => {
    const piece = scaleLine();
    const { piece: arranged, reversed } = arrangeMobilePiece(piece, { reverseColumns: true });

    expect(reversed).toBe(true);
    expect(cellIds(arranged)).toEqual([...SCORES].reverse());
    expect(arranged.columns.map((c) => c.id)).toEqual([...SCORES].reverse().map((id) => `c-${id}`));
  });

  it('입력 조각을 바꾸지 않는다', () => {
    const piece = scaleLine();
    const before = JSON.stringify(piece);
    arrangeMobilePiece(piece, { reverseColumns: true });
    expect(JSON.stringify(piece)).toBe(before);
  });

  it('칸과 열의 id 는 그대로다 — 응답 키와 셀 표시 인스턴스가 여기에 걸려 있다', () => {
    const piece = matrixRow();
    const { piece: arranged } = arrangeMobilePiece(piece, { reverseColumns: true });
    expect([...cellIds(arranged)].sort()).toEqual([...cellIds(piece)].sort());
    expect(arranged.columns.map((c) => c.id).sort()).toEqual(piece.columns.map((c) => c.id).sort());
  });

  it('머리 구간이 뒤집힌 열과 같은 자리에 선다 (1·3·3·3·1)', () => {
    const { piece: arranged } = arrangeMobilePiece(scaleLine(), { reverseColumns: true });
    expect(headerPlacement(arranged)).toEqual(['긍정@1+1', '점2@2+3', '보통@5+3', '점1@8+3', '부정@11+1']);
  });

  it('끝에 붙은 「평균에서 제외」 칸은 제자리에 두고 점수 칸만 뒤집는다', () => {
    const { piece: arranged, reversed } = arrangeMobilePiece(matrixRow(), { reverseColumns: true });

    expect(reversed).toBe(true);
    expect(cellIds(arranged)).toEqual([...[...SCORES].reverse(), 'na']);
    expect(arranged.columns.at(-1)?.id).toBe('c-na');
    expect(headerPlacement(arranged)).toEqual([
      '긍정@1+2',
      '점2@3+2',
      '보통@5+3',
      '점1@8+2',
      '부정@10+2',
      '해당없음@12+1',
    ]);
  });

  it('「평균에서 제외」 칸이 앞에 붙은 조각 — 앞 칸이 제자리다', () => {
    const piece: MobilePiece = {
      columns: [col('c-na'), col('c1'), col('c2'), col('c3')],
      rows: [row('r1', [choice('na', { excludeFromMean: true }), choice('a'), choice('b'), choice('c')])],
      interactiveRowId: 'r1',
    };
    expect(cellIds(arrangeMobilePiece(piece, { reverseColumns: true }).piece)).toEqual(['na', 'c', 'b', 'a']);
  });

  it('「평균에서 제외」 칸이 양끝에 붙은 조각 — 가운데만 뒤집힌다', () => {
    const piece: MobilePiece = {
      columns: ['x', 'c1', 'c2', 'c3', 'y'].map((id) => col(id)),
      rows: [
        row('r1', [
          choice('모름', { excludeFromMean: true }),
          choice('a'),
          choice('b'),
          choice('c'),
          choice('해당없음', { excludeFromMean: true }),
        ]),
      ],
      interactiveRowId: 'r1',
    };
    expect(cellIds(arrangeMobilePiece(piece, { reverseColumns: true }).piece)).toEqual([
      '모름',
      'c',
      'b',
      'a',
      '해당없음',
    ]);
  });

  it('반복 헤더 행도 응답 행과 같은 순서로 뒤집힌다', () => {
    const piece: MobilePiece = {
      columns: ['c1', 'c2', 'c3'].map((id) => col(id)),
      rows: [
        row('rep', [text('t1'), text('t2'), text('t3')]),
        row('r1', [choice('a'), choice('b'), choice('c')]),
      ],
      interactiveRowId: 'r1',
    };
    const { piece: arranged } = arrangeMobilePiece(piece, { reverseColumns: true });
    expect(cellIds(arranged, 'rep')).toEqual(['t3', 't2', 't1']);
    expect(cellIds(arranged, 'r1')).toEqual(['c', 'b', 'a']);
  });

  it('가로로 합친 본문 칸은 통째로 옮기고, 덮은 자리는 합친 칸 뒤에 남는다', () => {
    const piece: MobilePiece = {
      columns: ['c1', 'c2', 'c3', 'c4'].map((id) => col(id)),
      rows: [
        row('rep', [text('넓은', { colspan: 2 }), text('가림', { isHidden: true }), text('t3'), text('t4')]),
        row('r1', [choice('a'), choice('b'), choice('c'), choice('d')]),
      ],
      interactiveRowId: 'r1',
    };
    const { piece: arranged } = arrangeMobilePiece(piece, { reverseColumns: true });
    expect(cellIds(arranged, 'rep')).toEqual(['t4', 't3', '넓은', '가림']);
    expect(arranged.rows[0]!.cells[2]!.colspan).toBe(2);
  });

  it('열 머리글 병합(다단 헤더가 없는 표)도 통째로 옮긴다', () => {
    const piece: MobilePiece = {
      columns: [col('c1', { colspan: 2 }), col('c2', { isHeaderHidden: true }), col('c3')],
      rows: [row('r1', [choice('a'), choice('b'), choice('c')])],
      interactiveRowId: 'r1',
    };
    const { piece: arranged } = arrangeMobilePiece(piece, { reverseColumns: true });
    expect(arranged.columns.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
    expect(cellIds(arranged)).toEqual(['c', 'b', 'a']);
  });

  it('세로로 합친 머리 칸이 있는 다단 헤더도 거울 자리에 선다', () => {
    const piece: MobilePiece = {
      columns: ['c1', 'c2', 'c3', 'c4'].map((id) => col(id)),
      headerGrid: [
        [head('세로', 1, { rowspan: 2 }), head('넓은', 2), head('끝', 1)],
        [head('아래1', 1), head('아래2', 1), head('아래3', 1)],
      ],
      rows: [row('r1', [choice('a'), choice('b'), choice('c'), choice('d')])],
      interactiveRowId: 'r1',
    };
    const { piece: arranged } = arrangeMobilePiece(piece, { reverseColumns: true });
    expect(headerPlacement(arranged)).toEqual([
      '끝@1+1',
      '넓은@2+2',
      '세로@4+1',
      '아래3@1+1',
      '아래2@2+1',
      '아래1@3+1',
    ]);
  });

  it('뒤집을 칸이 하나 이하면 그대로다', () => {
    const piece: MobilePiece = {
      columns: [col('c1'), col('c-na')],
      rows: [row('r1', [choice('a'), choice('na', { excludeFromMean: true })])],
      interactiveRowId: 'r1',
    };
    const result = arrangeMobilePiece(piece, { reverseColumns: true });
    expect(result.piece).toBe(piece);
    expect(result.reversed).toBe(false);
    expect(result.reverseFallback).toBeNull();
  });
});

describe('arrangeMobilePiece — 세로선 숨김은 경계를 따라간다', () => {
  it('한 줄 척도 — 숨긴 경계가 거울 자리로 간다', () => {
    const piece = scaleLine();
    expect(hiddenHeaderBoundaries(piece)).toEqual([1, 4, 7, 10]);

    const { piece: arranged } = arrangeMobilePiece(piece, { reverseColumns: true });
    // 경계 p(왼쪽 열 번호) 는 11 − p 로 간다
    expect(hiddenHeaderBoundaries(arranged)).toEqual([1, 4, 7, 10]);
  });

  it('비대칭으로 숨긴 경계 — 「A|B」 사이 선을 숨겼으면 뒤집힌 뒤에도 「B|A」 사이가 숨는다', () => {
    const piece: MobilePiece = {
      columns: ['c1', 'c2', 'c3', 'c4'].map((id) => col(id)),
      headerGrid: [[head('A', 1, { hideRightBorder: true }), head('B', 1), head('C', 1), head('D', 1)]],
      rows: [row('r1', [choice('a'), choice('b'), choice('c'), choice('d')])],
      interactiveRowId: 'r1',
    };
    expect(hiddenHeaderBoundaries(piece)).toEqual([1]);

    const { piece: arranged } = arrangeMobilePiece(piece, { reverseColumns: true });
    expect(headerPlacement(arranged)).toEqual(['D@1+1', 'C@2+1', 'B@3+1', 'A@4+1']);
    // B 와 A 사이 = 3번 열의 오른쪽
    expect(hiddenHeaderBoundaries(arranged)).toEqual([3]);
  });

  it('고정 칸과의 경계는 그대로 남는다', () => {
    const piece = matrixRow();
    // 「긍정」(끝 점수 구간)과 「해당없음」 사이를 숨겨 본다
    piece.headerGrid![0]![4] = head('긍정', 2, { hideRightBorder: true });
    expect(hiddenHeaderBoundaries(piece)).toEqual([2, 4, 7, 9, 11]);

    const { piece: arranged } = arrangeMobilePiece(piece, { reverseColumns: true });
    expect(hiddenHeaderBoundaries(arranged)).toEqual([2, 4, 7, 9, 11]);
    // 11번 경계를 쥔 칸은 이제 「부정」이다(뒤집힌 구간의 끝)
    const last = expandHeaderGrid(arranged.headerGrid!).find(({ cell }) => cell.id === '부정');
    expect(last?.cell.hideRightBorder).toBe(true);
  });

  it('본문 칸의 세로선 숨김도 같은 경계에 남는다', () => {
    const piece: MobilePiece = {
      columns: ['c1', 'c2', 'c3'].map((id) => col(id)),
      rows: [row('r1', [choice('a', { hideRightBorder: true }), choice('b'), choice('c')])],
      interactiveRowId: 'r1',
    };
    const { piece: arranged } = arrangeMobilePiece(piece, { reverseColumns: true });
    const cells = arranged.rows[0]!.cells;
    expect(cells.map((c) => c.id)).toEqual(['c', 'b', 'a']);
    // a|b 사이 → b|a 사이 = b 의 오른쪽
    expect(cells.map((c) => c.hideRightBorder === true)).toEqual([false, true, false]);
  });

  it('열 머리글(다단 헤더 없음)의 세로선 숨김도 같은 경계에 남는다', () => {
    const piece: MobilePiece = {
      columns: [col('c1', { hideRightBorder: true }), col('c2'), col('c3')],
      rows: [row('r1', [choice('a'), choice('b'), choice('c')])],
      interactiveRowId: 'r1',
    };
    const { piece: arranged } = arrangeMobilePiece(piece, { reverseColumns: true });
    expect(arranged.columns.map((c) => [c.id, c.hideRightBorder === true])).toEqual([
      ['c3', false],
      ['c2', true],
      ['c1', false],
    ]);
  });
});

describe('arrangeMobilePiece — 반전 폴백', () => {
  it('뒤집는 구간과 고정 칸을 함께 덮는 머리 칸이 있으면 작성 순서 그대로다', () => {
    const piece = matrixRow();
    piece.headerGrid = [
      [head('부정', 2), head('점1', 2), head('보통', 3), head('점2', 2), head('긍정+해당없음', 3)],
    ];
    const result = arrangeMobilePiece(piece, { reverseColumns: true });

    expect(result.piece).toBe(piece);
    expect(result.reversed).toBe(false);
    expect(result.reverseFallback).toBe('merged-across-pinned');
  });

  it('뒤집는 구간과 고정 칸을 함께 덮는 본문 칸이 있어도 폴백이다', () => {
    const piece: MobilePiece = {
      columns: ['c1', 'c2', 'c3', 'c-na'].map((id) => col(id)),
      rows: [
        row('rep', [text('t1'), text('t2'), text('넓은', { colspan: 2 }), text('가림', { isHidden: true })]),
        row('r1', [choice('a'), choice('b'), choice('c'), choice('na', { excludeFromMean: true })]),
      ],
      interactiveRowId: 'r1',
    };
    expect(arrangeMobilePiece(piece, { reverseColumns: true }).reverseFallback).toBe(
      'merged-across-pinned',
    );
  });

  it('응답 행이 조각에 없으면 손대지 않는다', () => {
    const piece = { ...scaleLine(), interactiveRowId: 'none' };
    const result = arrangeMobilePiece(piece, { reverseColumns: true, columnsPerView: 6 });
    expect(result.piece).toBe(piece);
    expect(result.reversed).toBe(false);
    expect(result.fit).toBeNull();
  });
});

describe('arrangeMobilePiece — 한 화면 칸 수', () => {
  it('보기 칸만 있는 조각은 대상이다 — 열 11 · 6칸이면 자리 폭을 6 으로 나눈다', () => {
    const result = arrangeMobilePiece(scaleLine(), { columnsPerView: 6 });
    expect(result.fit).toEqual({ columnsPerView: 6, divisor: 6 });
    expect(result.fitFallback).toBeNull();
  });

  it('열 수가 칸 수 이하면 열 수로 나눠 자리를 꽉 채운다', () => {
    const piece: MobilePiece = {
      columns: ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => col(id)),
      rows: [row('r1', ['a', 'b', 'c', 'd', 'e'].map((id) => choice(id)))],
      interactiveRowId: 'r1',
    };
    expect(arrangeMobilePiece(piece, { columnsPerView: 6 }).fit).toEqual({
      columnsPerView: 6,
      divisor: 5,
    });
  });

  it('글자 칸이 섞여도 응답 칸이 전부 보기 칸이면 대상이다', () => {
    const piece: MobilePiece = {
      columns: ['c0', 'c1', 'c2'].map((id) => col(id)),
      rows: [row('r1', [text('단위'), choice('a'), choice('b')])],
      interactiveRowId: 'r1',
    };
    expect(arrangeMobilePiece(piece, { columnsPerView: 4 }).fit).toEqual({
      columnsPerView: 4,
      divisor: 3,
    });
  });

  it('보기가 하나뿐인 라디오·체크박스 칸(행렬 척도)도 대상이다', () => {
    const radioCell = (id: string): TableCell => ({
      id,
      type: 'radio',
      content: '',
      radioOptions: [{ id: `${id}-1`, label: '1점', value: '1' }],
    });
    const piece: MobilePiece = {
      columns: ['c1', 'c2', 'c3'].map((id) => col(id)),
      rows: [row('r1', [radioCell('a'), radioCell('b'), radioCell('c')])],
      interactiveRowId: 'r1',
    };
    expect(arrangeMobilePiece(piece, { columnsPerView: 6 }).fit).not.toBeNull();
  });

  it('입력 칸이 섞인 조각은 원본 폭 그대로다', () => {
    const piece: MobilePiece = {
      columns: ['c1', 'c2', 'c3'].map((id) => col(id)),
      rows: [row('r1', [choice('a'), choice('b'), input('기타')])],
      interactiveRowId: 'r1',
    };
    const result = arrangeMobilePiece(piece, { columnsPerView: 6 });
    expect(result.fit).toBeNull();
    expect(result.fitFallback).toBe('non-choice-answer-cell');
    expect(result.piece).toBe(piece);
  });

  it('보기가 여럿 든 라디오 칸은 좁은 칸에 못 넣는다', () => {
    const piece: MobilePiece = {
      columns: [col('c1')],
      rows: [
        row('r1', [
          {
            id: 'a',
            type: 'radio',
            content: '',
            radioOptions: [
              { id: 'o1', label: '예', value: '1' },
              { id: 'o2', label: '아니오', value: '2' },
            ],
          },
        ]),
      ],
      interactiveRowId: 'r1',
    };
    expect(arrangeMobilePiece(piece, { columnsPerView: 6 }).fitFallback).toBe('non-choice-answer-cell');
  });

  it('응답 칸이 없는 조각은 대상이 아니다', () => {
    const piece: MobilePiece = {
      columns: [col('c1'), col('c2')],
      rows: [row('r1', [text('a'), text('b')])],
      interactiveRowId: 'r1',
    };
    const result = arrangeMobilePiece(piece, { columnsPerView: 6 });
    expect(result.fit).toBeNull();
    expect(result.fitFallback).toBe('no-answer-cell');
  });

  it.each([2, 7, 4.5, Number.NaN])('범위 밖 칸 수 %s 는 꺼진 것으로 읽는다', (count) => {
    const piece = scaleLine();
    const result = arrangeMobilePiece(piece, { columnsPerView: count });
    expect(result.fit).toBeNull();
    expect(result.fitFallback).toBeNull();
    expect(result.piece).toBe(piece);
  });

  it('반전과 함께 켜면 둘 다 적용된다', () => {
    const result = arrangeMobilePiece(matrixRow(), { reverseColumns: true, columnsPerView: 6 });
    expect(result.reversed).toBe(true);
    expect(result.fit).toEqual({ columnsPerView: 6, divisor: 6 });
    expect(cellIds(result.piece).slice(0, 6)).toEqual(['s10', 's9', 's8', 's7', 's6', 's5']);
  });
});

describe('resolveHeaderOverflowDirections — 넘길 방향은 세로선이 숨겨진 쪽', () => {
  const directions = (piece: MobilePiece) =>
    Object.fromEntries(resolveHeaderOverflowDirections(piece));

  it('오른쪽 선만 숨김 → 오른쪽으로 · 왼쪽 선만 숨김 → 왼쪽으로 · 양쪽 → 양쪽으로 · 없음 → 넘기지 않음', () => {
    const piece: MobilePiece = {
      columns: ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => col(id)),
      headerGrid: [
        [
          head('첫', 1, { hideRightBorder: true }),
          head('가운데', 1, { hideRightBorder: true }),
          head('왼쪽만', 1),
          head('없음', 1),
          head('끝', 1),
        ],
      ],
      rows: [row('r1', ['a', 'b', 'c', 'd', 'e'].map((id) => choice(id)))],
      interactiveRowId: 'r1',
    };
    expect(directions(piece)).toEqual({
      첫: 'right',
      가운데: 'both',
      왼쪽만: 'left',
      없음: 'none',
      끝: 'none',
    });
  });

  it('마지막 열에 닿는 칸은 오른쪽으로 넘기지 않는다 — 그 선은 표의 끝선이라 숨겨지지 않는다', () => {
    const piece: MobilePiece = {
      columns: ['c1', 'c2'].map((id) => col(id)),
      headerGrid: [[head('A', 1, { hideRightBorder: true }), head('B', 1, { hideRightBorder: true })]],
      rows: [row('r1', [choice('a'), choice('b')])],
      interactiveRowId: 'r1',
    };
    expect(directions(piece)).toEqual({ A: 'right', B: 'left' });
  });

  it('한 줄 척도를 뒤집으면 첫 칸은 오른쪽으로, 끝 칸은 왼쪽으로 넘긴다', () => {
    const { piece: arranged } = arrangeMobilePiece(scaleLine(), { reverseColumns: true });
    const result = directions(arranged);
    expect(result['긍정']).toBe('right');
    expect(result['부정']).toBe('left');
    expect(result['보통']).toBe('both');
  });

  it('다단 헤더가 없으면 열 머리글로 본다', () => {
    const piece: MobilePiece = {
      columns: [col('c1', { hideRightBorder: true }), col('c2'), col('c3')],
      rows: [row('r1', [choice('a'), choice('b'), choice('c')])],
      interactiveRowId: 'r1',
    };
    expect(directions(piece)).toEqual({ c1: 'right', c2: 'left', c3: 'none' });
  });
});
