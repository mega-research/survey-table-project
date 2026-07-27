import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CellOptionsContainer } from '@/components/survey-builder/cells/cell-options-container';
import type { TableCell } from '@/types/survey';

// jsdom 은 실제 픽셀 폭을 측정할 수 없으므로(shrink-to-fit vs 100% 폭 차이는
// 레이아웃 엔진에서만 드러남), 여기서는 "그리드일 때 flex item 래퍼(space-y-2)에
// w-full 클래스가 실제로 존재하는가"만 회귀 가드로 단언한다. 픽셀 단위 검증은
// 브라우저/E2E 영역.
function makeCell(optionsColumns: number | undefined): TableCell {
  return {
    id: 'c1',
    type: 'radio',
    content: '',
    optionsColumns,
    radioOptions: [
      { id: 'o1', label: '옵션1', value: '1' },
      { id: 'o2', label: '옵션2', value: '2' },
      { id: 'o3', label: '옵션3', value: '3' },
    ],
  } as unknown as TableCell;
}

describe('CellOptionsContainer 그리드 폭 (space-y-2 래퍼)', () => {
  afterEach(cleanup);

  it('optionsColumns >= 2 (그리드) 이면 space-y-2 래퍼가 w-full 을 갖는다', () => {
    const cell = makeCell(3);
    const { container } = render(
      <CellOptionsContainer cell={cell}>
        <div>a</div>
        <div>b</div>
        <div>c</div>
      </CellOptionsContainer>,
    );

    const wrapper = container.querySelector('.space-y-2');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.className).toContain('w-full');

    const grid = wrapper!.querySelector('.options-grid');
    expect(grid).toBeTruthy();
  });

  it('optionsColumns 1 (세로) 이면 space-y-2 래퍼에 w-full 이 없다', () => {
    const cell = makeCell(1);
    const { container } = render(
      <CellOptionsContainer cell={cell}>
        <div>a</div>
      </CellOptionsContainer>,
    );

    const wrapper = container.querySelector('.space-y-2');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.className).not.toContain('w-full');
  });

  it('optionsColumns 미지정 (세로 기본) 이면 space-y-2 래퍼에 w-full 이 없다', () => {
    const cell = makeCell(undefined);
    const { container } = render(
      <CellOptionsContainer cell={cell}>
        <div>a</div>
      </CellOptionsContainer>,
    );

    const wrapper = container.querySelector('.space-y-2');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.className).not.toContain('w-full');
  });

  it('optionsColumns 0 (가로) 이면 space-y-2 래퍼에 w-full 이 없다', () => {
    const cell = makeCell(0);
    const { container } = render(
      <CellOptionsContainer cell={cell}>
        <div>a</div>
      </CellOptionsContainer>,
    );

    const wrapper = container.querySelector('.space-y-2');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.className).not.toContain('w-full');
  });
});
