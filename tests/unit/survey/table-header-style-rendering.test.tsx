import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { InteractiveTableResponse } from '@/components/survey-builder/interactive-table-response';
import { TablePreview } from '@/components/survey-builder/table-preview';

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

describe('테이블 헤더 스타일 렌더링', () => {
  it('TablePreview 단일 헤더에 배경색과 Bold를 표시한다', () => {
    render(
      <TablePreview
        columns={[
          {
            id: 'c1',
            label: '성별',
            textBold: true,
            backgroundColor: '#DDEEFF',
          },
        ]}
        rows={[]}
      />,
    );

    const header = screen.getByRole('columnheader', { name: '성별' });
    expect(header).toHaveStyle({ backgroundColor: '#DDEEFF' });
    expect(header).toHaveClass('font-bold');
  });

  it('InteractiveTableResponse 병합 다단계 헤더에 배경색과 Bold를 표시한다', () => {
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={[
          { id: 'c1', label: '남성' },
          { id: 'c2', label: '여성' },
        ]}
        rows={[]}
        tableHeaderGrid={[
          [
            {
              id: 'h1',
              label: '성별',
              colspan: 2,
              rowspan: 1,
              textBold: true,
              backgroundColor: '#FFEEDD',
            },
          ],
        ]}
        value={{}}
        onChange={vi.fn()}
      />,
    );

    const header = screen.getByRole('columnheader', { name: '성별' });
    expect(header).toHaveStyle({ backgroundColor: '#FFEEDD' });
    expect(header).toHaveClass('font-bold');
    expect(header).toHaveAttribute('aria-colspan', '2');
  });
});
