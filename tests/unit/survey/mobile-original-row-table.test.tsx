import type { MutableRefObject } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { InteractiveCell } from '@/components/survey-builder/cells';
import { MobileOriginalRowTable } from '@/components/survey-builder/mobile-original-row-table';
import type { TableCell, TableColumn, TableRow } from '@/types/survey';

const col = (label: string): TableColumn => ({ id: label, label, width: 120 });
const row = (cells: TableCell[], id = 'r1'): TableRow => ({ id, label: id, cells });
const inputCell: TableCell = { id: 'input', type: 'input', content: '', placeholder: '점수' };

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function renderOriginalRow({ hideColumnLabels = false } = {}) {
  return render(
    <MobileOriginalRowTable
      columns={[col('항목'), col('점수')]}
      row={row([{ id: 'label', type: 'text', content: '직무' }, inputCell])}
      headerGrid={[[{ id: 'h', label: '묶음 헤더', colspan: 2, rowspan: 1 }]]}
      hideColumnLabels={hideColumnLabels}
      renderCell={(cell) => (
        <InteractiveCell cell={cell} questionId="q1" isTestMode value={{}} onChange={vi.fn()} />
      )}
    />,
  );
}

describe('MobileOriginalRowTable', () => {
  it('정적 hidden 콘텐츠는 숨기고 interactive hidden 입력은 유지한다', () => {
    render(
      <MobileOriginalRowTable
        columns={[col('정적'), col('입력')]}
        row={row([
          { id: 'label', type: 'text', content: '숨길 내용', mobileDisplay: 'hidden' },
          {
            id: 'input',
            type: 'input',
            content: '숨길 라벨',
            placeholder: '점수',
            mobileDisplay: 'hidden',
          },
        ])}
        hideColumnLabels={false}
        renderCell={(cell) => (
          <InteractiveCell
            cell={cell}
            questionId="q1"
            isTestMode
            value={{}}
            onChange={() => {}}
          />
        )}
      />,
    );
    expect(screen.queryByText('숨길 내용')).toBeNull();
    expect(screen.queryByText('숨길 라벨')).toBeNull();
    expect(screen.getByPlaceholderText('점수')).toBeInTheDocument();
  });

  it('hideColumnLabels이면 다단 헤더 전체를 렌더하지 않는다', () => {
    renderOriginalRow({ hideColumnLabels: true });
    expect(screen.queryByRole('columnheader')).toBeNull();
  });

  it('_isContinuation 셀은 grid cell과 입력을 모두 렌더하지 않는다', () => {
    render(
      <MobileOriginalRowTable
        columns={[col('점수')]}
        row={row([{ ...inputCell, _isContinuation: true }])}
        hideColumnLabels={false}
        renderCell={(cell) => (
          <InteractiveCell
            cell={cell}
            questionId="q1"
            isTestMode
            value={{}}
            onChange={vi.fn()}
          />
        )}
      />,
    );
    expect(screen.queryByPlaceholderText('점수')).toBeNull();
    expect(screen.queryByTestId('cell-input')).toBeNull();
  });

  it('행이 바뀌어도 scrollLeft를 복원하고 reset key에서 0으로 초기화한다', () => {
    const scrollLeftRef: MutableRefObject<number> = { current: 120 };
    const renderCell = (cell: TableCell) => (
      <InteractiveCell cell={cell} questionId="q1" isTestMode value={{}} onChange={vi.fn()} />
    );
    const { rerender } = render(
      <MobileOriginalRowTable
        columns={[col('점수')]}
        row={row([inputCell])}
        hideColumnLabels={false}
        scrollLeftRef={scrollLeftRef}
        renderCell={renderCell}
      />,
    );
    const scroller = screen.getByTestId('table-preview-scroll');
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 500 });
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 200 });
    rerender(
      <MobileOriginalRowTable
        columns={[col('점수')]}
        row={row([{ ...inputCell, id: 'input-2' }], 'r2')}
        hideColumnLabels={false}
        scrollLeftRef={scrollLeftRef}
        renderCell={renderCell}
      />,
    );
    expect(scroller.scrollLeft).toBe(120);
    scroller.scrollLeft = 80;
    fireEvent.scroll(scroller);
    expect(scrollLeftRef.current).toBe(80);
    rerender(
      <MobileOriginalRowTable
        columns={[col('점수')]}
        row={row([{ ...inputCell, id: 'input-2' }], 'r2')}
        hideColumnLabels={false}
        scrollLeftRef={scrollLeftRef}
        resetScrollKey="toc"
        renderCell={renderCell}
      />,
    );
    expect(scrollLeftRef.current).toBe(0);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('단일 헤더와 body 병합 semantics를 보존하고 숨김 셀은 생략한다', () => {
    render(
      <MobileOriginalRowTable
        columns={[
          { ...col('병합 헤더'), colspan: 2 },
          { ...col('헤더 continuation'), isHeaderHidden: true },
          col('마지막'),
        ]}
        row={row([
          { id: 'merged', type: 'text', content: '병합 본문', colspan: 2, rowspan: 2 },
          { id: 'hidden', type: 'text', content: '숨김 본문', isHidden: true },
          inputCell,
        ])}
        hideColumnLabels={false}
        renderCell={(cell) => <span>{cell.content}</span>}
      />,
    );

    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveAttribute('aria-colspan', '2');
    const merged = screen.getByTestId('cell-merged');
    expect(merged).toHaveAttribute('aria-colspan', '2');
    expect(merged).toHaveAttribute('aria-rowspan', '2');
    expect(screen.queryByText('숨김 본문')).toBeNull();
  });

  it('body cell 식별자와 오류 ring을 노출한다', () => {
    render(
      <MobileOriginalRowTable
        columns={[col('점수')]}
        row={row([inputCell])}
        hideColumnLabels
        errorCellIds={new Set(['input'])}
        renderCell={(cell) => <span>{cell.id}</span>}
      />,
    );

    const cell = screen.getByTestId('cell-input');
    expect(cell).toHaveAttribute('data-cell-id', 'input');
    expect(cell).toHaveClass('ring-2', 'ring-inset', 'ring-red-300');
  });
});
