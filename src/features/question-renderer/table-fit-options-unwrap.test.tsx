import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InteractiveTableResponse } from '@/features/question-renderer/interactive-table-response';
import { TablePreview } from '@/features/question-renderer/table-preview';
import type { TableColumn, TableRow } from '@/types/survey';

// 화면 폭에 맞춰 줄인 표(fitTableToWidth)의 본문에는 표식(data-fit-table)이 붙는다 — globals.css 가 이 표식
// 아래의 보기 N열 그리드를 「좁으면 보기째로 다음 줄」로 푼다(패드 폭에서 보기 글자가 칸 안에서 꺾이던 것).
// 켜지 않은 표에는 붙지 않아 기존 그리드 그대로다.
//
// 줄이는 것은 패드 폭(768~1023px)에서만이다(2026-11-24). 데스크톱(1024px 이상)은 켜 두어도 지정한 px 그대로
// 그리고(창이 좁으면 가로 스크롤), 휴대폰(768px 미만)은 모바일 표시 방식을 따른다.
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

/** 흉내 낼 창 폭 — matchMedia 가 이 값으로 min-width·max-width 를 판정한다 */
let viewportWidth = 900;
function matchesQuery(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (min && viewportWidth < Number(min[1])) return false;
  if (max && viewportWidth > Number(max[1])) return false;
  return true;
}

beforeAll(() => {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserver;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      get matches() {
        return matchesQuery(query);
      },
      addEventListener() {},
      removeEventListener() {},
    }),
  });
});
beforeEach(() => {
  viewportWidth = 900;
});
afterEach(cleanup);

const fitMarked = (cellId: string) => screen.getByTestId(`cell-${cellId}`).closest('[data-fit-table]');

describe('화면 폭에 맞춰 줄인 표 — 보기 그리드 풀기 표식 (패드 폭)', () => {
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

describe('화면 폭에 맞춰 표 줄이기 — 패드 폭(768~1023px)에서만', () => {
  const gridOf = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[style*="grid-template-columns"]');

  it.each([
    ['패드 세로 768px', 768, true],
    ['패드 1023px', 1023, true],
    ['데스크톱 1024px (눕힌 패드 포함)', 1024, false],
    ['데스크톱 1280px', 1280, false],
    ['휴대폰 767px', 767, false],
  ])('TablePreview: %s', (_name, width, fits) => {
    viewportWidth = width;
    const { container } = render(<TablePreview columns={columns} rows={rows} fitTableToWidth />);
    expect(container.querySelector('[data-fit-table]') !== null).toBe(fits);
    const grid = gridOf(container)!;
    if (fits) {
      expect(grid.style.gridTemplateColumns).toBe('minmax(0, 200fr) minmax(0, 600fr)');
      expect(grid.style.maxWidth).toBe('800px');
    } else {
      // 지정한 px 그대로 — 창이 좁으면 표가 넘쳐 가로 스크롤이 된다
      expect(grid.style.gridTemplateColumns).toBe('200px 600px');
      expect(grid.style.width).toBe('800px');
      expect(grid.style.minWidth).toBe('800px');
    }
  });

  it.each([
    ['패드 900px', 900, true],
    ['데스크톱 1024px', 1024, false],
    ['데스크톱 1440px', 1440, false],
  ])('InteractiveTableResponse: %s', (_name, width, fits) => {
    viewportWidth = width;
    const { container } = render(
      <InteractiveTableResponse questionId="q1" columns={columns} rows={rows} fitTableToWidth />,
    );
    expect(container.querySelector('[data-fit-table]') !== null).toBe(fits);
    const grid = gridOf(container)!;
    expect(grid.style.gridTemplateColumns).toBe(
      fits ? 'minmax(0, 200fr) minmax(0, 600fr)' : '200px 600px',
    );
  });

  it('끈 표는 어느 폭에서도 px 고정이다', () => {
    for (const width of [900, 1280]) {
      viewportWidth = width;
      const { container, unmount } = render(<TablePreview columns={columns} rows={rows} />);
      expect(gridOf(container)!.style.gridTemplateColumns).toBe('200px 600px');
      unmount();
    }
  });
});

