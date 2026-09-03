import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { HeaderGridEditor } from '@/features/survey-builder/table-editor/header-grid-editor';
import type { HeaderCell } from '@/types/survey';

function HeaderGridHarness({ initialGrid }: { initialGrid: HeaderCell[][] }) {
  const [grid, setGrid] = useState(initialGrid);

  return (
    <>
      <HeaderGridEditor headerGrid={grid} columnCount={2} onChange={setGrid} />
      <output data-testid="header-grid">{JSON.stringify(grid)}</output>
    </>
  );
}

function getRenderedGrid(): HeaderCell[][] {
  return JSON.parse(screen.getByTestId('header-grid').textContent ?? '[]') as HeaderCell[][];
}

describe('HeaderGridEditor 헤더 스타일 보존', () => {
  it('스타일 적용 후 두 셀을 병합하면 첫 셀의 라벨과 스타일을 병합 셀에 보존한다', () => {
    render(
      <HeaderGridHarness
        initialGrid={[
          [
            {
              id: 'header-1',
              label: '첫째',
              colspan: 1,
              rowspan: 1,
              textBold: true,
              backgroundColor: '#DDEEFF',
            },
            {
              id: 'header-2',
              label: '둘째',
              colspan: 1,
              rowspan: 1,
              textBold: true,
              backgroundColor: '#DDEEFF',
            },
          ],
        ]}
      />,
    );

    const firstCell = screen.getByText('첫째').parentElement;
    const secondCell = screen.getByText('둘째').parentElement;
    expect(firstCell).not.toBeNull();
    expect(secondCell).not.toBeNull();

    fireEvent.mouseDown(firstCell!, { detail: 1 });
    fireEvent.mouseEnter(secondCell!);
    fireEvent.mouseUp(secondCell!);
    fireEvent.click(screen.getByRole('button', { name: '병합' }));

    expect(getRenderedGrid()).toEqual([
      [
        expect.objectContaining({
          label: '첫째',
          colspan: 2,
          rowspan: 1,
          textBold: true,
          backgroundColor: '#DDEEFF',
        }),
      ],
    ]);
    expect(screen.queryByRole('button', { name: '병합' })).not.toBeInTheDocument();
  });

  it('스타일 적용 후 병합 셀을 분할하면 생성된 모든 셀에 원본 스타일을 보존한다', () => {
    render(
      <HeaderGridHarness
        initialGrid={[
          [
            {
              id: 'header-1',
              label: '병합 헤더',
              colspan: 2,
              rowspan: 2,
              textBold: true,
              backgroundColor: '#DDEEFF',
            },
          ],
          [],
        ]}
      />,
    );

    const mergedCell = screen.getByText('병합 헤더').parentElement;
    expect(mergedCell).not.toBeNull();

    fireEvent.mouseDown(mergedCell!, { detail: 1 });
    fireEvent.mouseUp(mergedCell!);
    fireEvent.click(screen.getByRole('button', { name: '분할' }));

    const grid = getRenderedGrid();
    expect(grid).toHaveLength(2);
    expect(grid[0]).toHaveLength(2);
    expect(grid[1]).toHaveLength(2);
    expect(grid.flat()).toEqual([
      expect.objectContaining({
        label: '병합 헤더',
        colspan: 1,
        rowspan: 1,
        textBold: true,
        backgroundColor: '#DDEEFF',
      }),
      expect.objectContaining({
        label: '',
        colspan: 1,
        rowspan: 1,
        textBold: true,
        backgroundColor: '#DDEEFF',
      }),
      expect.objectContaining({
        label: '',
        colspan: 1,
        rowspan: 1,
        textBold: true,
        backgroundColor: '#DDEEFF',
      }),
      expect.objectContaining({
        label: '',
        colspan: 1,
        rowspan: 1,
        textBold: true,
        backgroundColor: '#DDEEFF',
      }),
    ]);
    expect(screen.queryByRole('button', { name: '분할' })).not.toBeInTheDocument();
  });

  it('사용자 지정 배경색 셀의 라벨 편집 입력창은 셀 배경을 가리지 않는다', () => {
    render(
      <HeaderGridHarness
        initialGrid={[
          [
            {
              id: 'header-1',
              label: '편집할 헤더',
              colspan: 1,
              rowspan: 1,
              backgroundColor: '#DDEEFF',
            },
            { id: 'header-2', label: '둘째', colspan: 1, rowspan: 1 },
          ],
        ]}
      />,
    );

    fireEvent.mouseDown(screen.getByText('편집할 헤더').parentElement!, { detail: 2 });

    expect(screen.getByDisplayValue('편집할 헤더')).toHaveClass('bg-transparent');
  });
});
