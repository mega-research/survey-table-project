import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { InteractiveTableResponse } from '@/features/question-renderer/interactive-table-response';
import { TablePreview } from '@/features/question-renderer/table-preview';
import type { TableColumn, TableRow } from '@/types/survey';

// 화면 폭에 맞춰 줄인 표(fitTableToWidth)의 본문에는 표식(data-fit-table)이 붙는다 — globals.css 가 이 표식
// 아래의 보기 N열 그리드를 「좁으면 보기째로 다음 줄」로 푼다(패드 폭에서 보기 글자가 칸 안에서 꺾이던 것).
// 켜지 않은 표에는 붙지 않아 기존 그리드 그대로다.
const columns: TableColumn[] = [
  { id: 'c1', label: '구분', width: 200 },
  { id: 'c2', label: '응답', width: 600 },
];
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '연령',
    cells: [
      { id: 'label', type: 'text', content: '연령' },
      {
        id: 'age',
        type: 'radio',
        content: '',
        optionsColumns: 4,
        radioOptions: [
          { id: 'o1', label: '① 20대 미만', value: '1' },
          { id: 'o2', label: '② 20∼30대', value: '2' },
        ],
      },
    ],
  },
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
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});
afterEach(cleanup);

const fitMarked = (cellId: string) => screen.getByTestId(`cell-${cellId}`).closest('[data-fit-table]');

describe('화면 폭에 맞춰 줄인 표 — 보기 그리드 풀기 표식', () => {
  it('TablePreview: 켜면 본문에 표식이 붙고, 끄면 없다', () => {
    const { unmount } = render(<TablePreview columns={columns} rows={rows} fitTableToWidth />);
    expect(fitMarked('age')).not.toBeNull();
    unmount();
    render(<TablePreview columns={columns} rows={rows} />);
    expect(fitMarked('age')).toBeNull();
  });

  it('InteractiveTableResponse: 켜면 본문에 표식이 붙고, 끄면 없다', () => {
    const { unmount, container } = render(
      <InteractiveTableResponse questionId="q1" columns={columns} rows={rows} fitTableToWidth />,
    );
    expect(container.querySelector('[data-fit-table] input[type="radio"]')).not.toBeNull();
    unmount();
    const off = render(<InteractiveTableResponse questionId="q1" columns={columns} rows={rows} />);
    expect(off.container.querySelector('[data-fit-table]')).toBeNull();
  });
});
