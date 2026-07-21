import type { MutableRefObject } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { InteractiveCell } from '@/components/survey-builder/cells';
import { MobileOriginalRowTable } from '@/components/survey-builder/mobile-original-row-table';
import type { TableCell, TableColumn, TableRow } from '@/types/survey';
import { projectMobileOriginalRow } from '@/utils/mobile-original-row';

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

function getHeaderScroller(): HTMLElement {
  const scroller = screen.getAllByRole('columnheader')[0]?.parentElement?.parentElement;
  if (!(scroller instanceof HTMLElement)) throw new Error('헤더 스크롤 컨테이너가 없습니다.');
  return scroller;
}

function setScrollGeometry(element: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth });
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
    const { container } = render(
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
    expect(container.querySelector('[data-cell-id="input"]')).toBeNull();
  });

  it('행이 바뀌면 저장한 scrollLeft를 헤더와 body에 함께 복원한다', () => {
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
    const bodyScroller = screen.getByTestId('table-preview-scroll');
    const headerScroller = getHeaderScroller();
    setScrollGeometry(bodyScroller, 500, 200);
    setScrollGeometry(headerScroller, 500, 200);
    scrollLeftRef.current = 120;
    rerender(
      <MobileOriginalRowTable
        columns={[col('점수')]}
        row={row([{ ...inputCell, id: 'input-2' }], 'r2')}
        hideColumnLabels={false}
        scrollLeftRef={scrollLeftRef}
        renderCell={renderCell}
      />,
    );
    expect(headerScroller.scrollLeft).toBe(120);
    expect(bodyScroller.scrollLeft).toBe(120);
  });

  it('짧은 행으로 바뀌면 헤더와 body를 유효 범위로 clamp하고 공유 ref를 갱신한다', () => {
    const scrollLeftRef: MutableRefObject<number> = { current: 240 };
    const renderCell = (cell: TableCell) => <span>{cell.id}</span>;
    const { rerender } = render(
      <MobileOriginalRowTable
        columns={[col('항목'), col('점수')]}
        row={row([{ id: 'label', type: 'text', content: '직무' }, inputCell])}
        hideColumnLabels={false}
        scrollLeftRef={scrollLeftRef}
        renderCell={renderCell}
      />,
    );
    const bodyScroller = screen.getByTestId('table-preview-scroll');
    const headerScroller = getHeaderScroller();
    setScrollGeometry(bodyScroller, 500, 200);
    setScrollGeometry(headerScroller, 500, 200);
    scrollLeftRef.current = 240;
    rerender(
      <MobileOriginalRowTable
        columns={[col('항목'), col('점수')]}
        row={row([{ id: 'label-2', type: 'text', content: '직무' }, inputCell], 'r2')}
        hideColumnLabels={false}
        scrollLeftRef={scrollLeftRef}
        renderCell={renderCell}
      />,
    );
    expect(bodyScroller.scrollLeft).toBe(240);

    setScrollGeometry(bodyScroller, 260, 200);
    setScrollGeometry(headerScroller, 260, 200);
    rerender(
      <MobileOriginalRowTable
        columns={[col('점수')]}
        row={row([{ ...inputCell, id: 'input-2' }], 'r3')}
        hideColumnLabels={false}
        scrollLeftRef={scrollLeftRef}
        renderCell={renderCell}
      />,
    );
    expect(headerScroller.scrollLeft).toBe(60);
    expect(bodyScroller.scrollLeft).toBe(60);
    expect(scrollLeftRef.current).toBe(60);
  });

  it('scroll 이벤트를 저장하고 reset key에서 헤더와 body 및 ref를 0으로 초기화한다', () => {
    const scrollLeftRef: MutableRefObject<number> = { current: 120 };
    const renderCell = (cell: TableCell) => <span>{cell.id}</span>;
    const { rerender } = render(
      <MobileOriginalRowTable
        columns={[col('점수')]}
        row={row([inputCell])}
        hideColumnLabels={false}
        scrollLeftRef={scrollLeftRef}
        renderCell={renderCell}
      />,
    );
    const bodyScroller = screen.getByTestId('table-preview-scroll');
    const headerScroller = getHeaderScroller();
    setScrollGeometry(bodyScroller, 500, 200);
    setScrollGeometry(headerScroller, 500, 200);
    scrollLeftRef.current = 120;
    rerender(
      <MobileOriginalRowTable
        columns={[col('점수')]}
        row={row([{ ...inputCell, id: 'input-2' }], 'r2')}
        hideColumnLabels={false}
        scrollLeftRef={scrollLeftRef}
        renderCell={renderCell}
      />,
    );
    bodyScroller.scrollLeft = 80;
    fireEvent.scroll(bodyScroller);
    expect(scrollLeftRef.current).toBe(80);
    expect(headerScroller.scrollLeft).toBe(80);
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
    expect(headerScroller.scrollLeft).toBe(0);
    expect(bodyScroller.scrollLeft).toBe(0);
  });

  it('단일 헤더와 body 병합 semantics를 보존하고 숨김 셀은 생략한다', () => {
    const { container } = render(
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
    expect(screen.queryByTestId('cell-hidden')).toBeNull();
    expect(container.querySelector('[data-cell-id="hidden"]')).toBeNull();
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

  it('continuation 상세에 materialize된 interactive anchor를 원본 cell id로 렌더하고 저장한다', () => {
    const columns = [col('항목'), col('공유 입력')];
    const projection = projectMobileOriginalRow({
      authoredColumns: columns,
      visibleColumns: columns,
      displayRows: [
        row([
          { id: 'label-1', type: 'text', content: '첫 행' },
          {
            id: 'shared-input-anchor',
            type: 'input',
            content: '',
            placeholder: '공유 응답 입력',
            rowspan: 2,
          },
        ], 'anchor-row'),
        row([
          { id: 'label-2', type: 'text', content: '둘째 행' },
          {
            id: 'shared-input-continuation',
            type: 'input',
            content: '',
            isHidden: true,
            _isContinuation: true,
          },
        ], 'continuation-row'),
      ],
      selectedRowId: 'continuation-row',
      omitLeadingAuthoredColumns: 1,
    });
    if (!projection) throw new Error('projection이 필요합니다.');
    const onChange = vi.fn();

    const { container } = render(
      <MobileOriginalRowTable
        columns={projection.columns}
        row={projection.row}
        hideColumnLabels={false}
        renderCell={(cell) => (
          <InteractiveCell
            cell={cell}
            questionId="rowspan-question"
            isTestMode={false}
            value={{}}
            onChange={onChange}
          />
        )}
      />,
    );

    expect(container.querySelector('[data-cell-id="shared-input-anchor"]')).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText('공유 응답 입력'), {
      target: { value: '연속 행 응답' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ 'shared-input-anchor': '연속 행 응답' });
  });
});
