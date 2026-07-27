import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { InteractiveTableResponse } from '@/components/survey-builder/interactive-table-response';
import { TablePreview } from '@/components/survey-builder/table-preview';
import type { TableColumn, TableRow } from '@/types/survey';

const columns: TableColumn[] = [
  { id: 'column-1', label: '첫 번째 열' },
  { id: 'column-2', label: '두 번째 열' },
];

beforeAll(() => {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserver;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
});

afterEach(cleanup);

describe('데스크톱 표 셀 스타일 렌더링', () => {
  it('TablePreview는 스타일이 있는 셀에만 배경색과 굵은 콘텐츠를 적용한다', () => {
    const rows: TableRow[] = [
      {
        id: 'row-1',
        label: '',
        cells: [
          {
            id: 'styled',
            type: 'text',
            content: '강조',
            textBold: true,
            backgroundColor: '#AABBCC',
          },
          { id: 'plain', type: 'text', content: '일반' },
        ],
      },
    ];

    render(<TablePreview columns={columns} rows={rows} />);

    expect(screen.getByTestId('cell-styled')).toHaveStyle({ backgroundColor: '#AABBCC' });
    expect(screen.getByText('강조')).toHaveClass('font-bold');
    expect(screen.getByTestId('cell-plain')).not.toHaveStyle({ backgroundColor: '#AABBCC' });
    expect(screen.getByText('일반')).not.toHaveClass('font-bold');
  });

  it('완료된 응답 행에서도 명시 배경색은 유지하고 병합 연속 셀에는 적용하지 않는다', () => {
    const rows: TableRow[] = [
      {
        id: 'row-1',
        label: '',
        cells: [
          {
            id: 'inputCellId',
            type: 'input',
            content: '완료 응답',
            backgroundColor: '#AABBCC',
          },
          {
            id: 'merged-anchor',
            type: 'text',
            content: '병합 앵커',
            colspan: 2,
            backgroundColor: '#DDEEFF',
          },
          {
            id: 'merged-continuation',
            type: 'text',
            content: '숨김 연속 셀',
            isHidden: true,
            backgroundColor: '#DDEEFF',
          },
        ],
      },
    ];

    render(
      <InteractiveTableResponse
        questionId="question-1"
        columns={columns}
        rows={rows}
        value={{ inputCellId: '완료 응답' }}
        onChange={() => {}}
      />,
    );

    expect(document.querySelector('[data-cell-id="inputCellId"]')).toHaveStyle({
      backgroundColor: '#AABBCC',
    });
    expect(document.querySelector('[data-cell-id="merged-anchor"]')).toHaveStyle({
      backgroundColor: '#DDEEFF',
    });
    expect(document.querySelector('[data-cell-id="merged-continuation"]')).not.toBeInTheDocument();
  });
});
