import { describe, expect, it } from 'vitest';

import type { HeaderCell, TableColumn } from '@/types/survey';

import { readOwnColumnHeaderName } from './scale-header-reading';

/**
 * 한 열만 덮는 머리 이름 읽기 — 척도 슬라이더가 눈금 밖으로 뗀 보기(「평균에서 제외」)의 글자를 머리에서
 * 읽을 때 쓴다. 눈금 열을 잘라 읽는 `readScaleHeader` 는 눈금 밖 열을 보지 않는다.
 */

const head = (id: string, label: string, colspan: number, rowspan = 1): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan,
});
// 항목 열 + 눈금 5열 + 척도 밖 1열
const columns = (labels: readonly string[] = ['', '', '', '', '', '', '']): TableColumn[] =>
  labels.map((label, n) => ({ id: `col${n}`, label }));

describe('readOwnColumnHeaderName — 그 열만 덮는 한 칸짜리 머리 이름', () => {
  it('그 열만 덮는 머리 칸의 글자를 읽는다', () => {
    const headerGrid = [
      [head('h-item', '항목', 1), head('h-scale', '만족도', 5), head('h-na', '이용한 적 없음', 1)],
    ];
    expect(readOwnColumnHeaderName({ columns: columns(), headerGrid, index: 6 })).toBe(
      '이용한 적 없음',
    );
  });

  it('여러 열을 묶은 머리는 그 열의 이름이 아니다', () => {
    const headerGrid = [[head('h-item', '항목', 1), head('h-all', '만족도', 6)]];
    expect(readOwnColumnHeaderName({ columns: columns(), headerGrid, index: 6 })).toBeUndefined();
  });

  it('위 줄이 여러 열을 묶은 제목이어도 아래 줄의 한 칸짜리 이름을 읽는다', () => {
    const headerGrid = [
      [head('h-item', '항목', 1, 2), head('h-all', '만족도', 6)],
      [
        head('h-1', '①', 1),
        head('h-2', '②', 1),
        head('h-3', '③', 1),
        head('h-4', '④', 1),
        head('h-5', '⑤', 1),
        head('h-na', '모름', 1),
      ],
    ];
    expect(readOwnColumnHeaderName({ columns: columns(), headerGrid, index: 6 })).toBe('모름');
  });

  it('한 칸짜리 이름이 여러 줄에 있으면 보기에 가까운 아래 줄이다', () => {
    const headerGrid = [
      [head('h-item', '항목', 1, 2), head('h-scale', '만족도', 5), head('h-up', '척도 밖', 1)],
      [
        head('h-1', '①', 1),
        head('h-2', '②', 1),
        head('h-3', '③', 1),
        head('h-4', '④', 1),
        head('h-5', '⑤', 1),
        head('h-na', '해당 없음', 1),
      ],
    ];
    expect(readOwnColumnHeaderName({ columns: columns(), headerGrid, index: 6 })).toBe('해당 없음');
  });

  it('위 줄에서 세로 병합으로 내려온 한 칸짜리 머리도 읽는다', () => {
    const headerGrid = [
      [head('h-item', '항목', 1, 2), head('h-scale', '만족도', 5), head('h-na', '모름', 1, 2)],
      [
        head('h-1', '①', 1),
        head('h-2', '②', 1),
        head('h-3', '③', 1),
        head('h-4', '④', 1),
        head('h-5', '⑤', 1),
      ],
    ];
    expect(readOwnColumnHeaderName({ columns: columns(), headerGrid, index: 6 })).toBe('모름');
  });

  it('글자가 빈 머리 칸은 건너뛰고 줄바꿈은 공백으로 잇는다', () => {
    const headerGrid = [
      [head('h-item', '항목', 1, 2), head('h-scale', '만족도', 5), head('h-na', '이용한 적\n없음', 1)],
      [
        head('h-1', '①', 1),
        head('h-2', '②', 1),
        head('h-3', '③', 1),
        head('h-4', '④', 1),
        head('h-5', '⑤', 1),
        head('h-blank', '  ', 1),
      ],
    ];
    expect(readOwnColumnHeaderName({ columns: columns(), headerGrid, index: 6 })).toBe(
      '이용한 적 없음',
    );
  });

  it('다단 헤더가 없는 표는 열 제목을 읽는다', () => {
    const labelled = columns(['항목', '①', '②', '③', '④', '⑤', '잘 모르겠음']);
    expect(readOwnColumnHeaderName({ columns: labelled, index: 6 })).toBe('잘 모르겠음');
    expect(readOwnColumnHeaderName({ columns: labelled, headerGrid: [], index: 6 })).toBe(
      '잘 모르겠음',
    );
    expect(readOwnColumnHeaderName({ columns: columns(), index: 6 })).toBeUndefined();
  });

  it('다단 헤더가 있으면 열 제목은 읽지 않는다 — 헤더 읽기와 같은 출처 규칙', () => {
    const labelled = columns(['항목', '①', '②', '③', '④', '⑤', '잘 모르겠음']);
    const headerGrid = [[head('h-item', '항목', 1), head('h-all', '만족도', 6)]];
    expect(readOwnColumnHeaderName({ columns: labelled, headerGrid, index: 6 })).toBeUndefined();
  });

  it('열 밖의 자리는 이름이 없다', () => {
    expect(readOwnColumnHeaderName({ columns: columns(), index: 9 })).toBeUndefined();
    expect(readOwnColumnHeaderName({ columns: columns(), index: -1 })).toBeUndefined();
  });
});
