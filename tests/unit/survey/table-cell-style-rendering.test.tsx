import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { InteractiveTableResponse } from '@/components/question-renderer/interactive-table-response';
import { InteractiveCell } from '@/components/question-renderer/cells/interactive-cell';
import { MobileOriginalRowTable } from '@/components/question-renderer/mobile-original-row-table';
import { TablePreview } from '@/components/question-renderer/table-preview';
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

  it('모바일 원본 행 표는 데스크톱 전용 셀 배경색을 적용하지 않는다', () => {
    const rows: TableRow[] = [
      {
        id: 'row-1',
        label: '',
        cells: [
          {
            id: 'mobile-styled',
            type: 'text',
            content: '모바일 유지',
            backgroundColor: '#AABBCC',
          },
        ],
      },
    ];

    render(
      <MobileOriginalRowTable
        columns={[columns[0]!]}
        rows={rows}
        interactiveRowId="row-1"
        hideColumnLabels={false}
        renderCell={(cell) => <span>{cell.content}</span>}
      />,
    );

    expect(screen.getByTestId('cell-mobile-styled')).not.toHaveStyle({
      backgroundColor: '#AABBCC',
    });
  });

  it.each([
    { id: 'image-cell', type: 'image' as const, content: '이미지 설명', imageUrl: '/image.png' },
    { id: 'video-cell', type: 'video' as const, content: '동영상 설명', videoUrl: '/video.mp4' },
    { id: 'ranking-opt-cell', type: 'ranking_opt' as const, content: '순위 옵션 설명' },
  ])('실제 응답 $type 셀은 콘텐츠만 굵게 표시한다', (cell) => {
    render(
      <InteractiveCell
        cell={{ ...cell, textBold: true }}
        questionId="question-1"
        isTestMode
        value={{}}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText(cell.content)).toHaveClass('font-bold');
  });
});
