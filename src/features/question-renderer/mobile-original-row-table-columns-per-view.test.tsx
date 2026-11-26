import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MobileOriginalRowTable } from '@/features/question-renderer/mobile-original-row-table';
import type { MobilePieceSettings } from '@/features/question-renderer/utils/mobile-piece-arrangement';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

/**
 * 원본 표 조각 — 조각 한 화면 칸 수와 좁은 칸의 머리 글자 넘김.
 * 칸 폭은 조각이 놓인 자리의 폭을 재서 낸다. jsdom 은 배치를 하지 않으므로 자리 폭을 손으로 준다.
 */

vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
}));

const slot = { width: 278 };
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return slot.width;
    },
  });
  return () => {
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
  };
});
afterEach(() => {
  slot.width = 278;
});

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const columns = (count = 11): TableColumn[] =>
  SCORES.slice(0, count).map((n) => ({ id: `col${n}`, label: `${n}`, width: 100 }));
const choice = (n: number): TableCell => ({
  id: `c${n}`,
  type: 'choice_opt',
  content: String(n),
});
const scaleRow = (count = 11): TableRow => ({
  id: 'r1',
  label: '전반 만족도',
  cells: SCORES.slice(0, count).map(choice),
});
const head = (id: string, colspan: number, hideRightBorder = false): HeaderCell => ({
  id,
  label: id,
  colspan,
  rowspan: 1,
  ...(hideRightBorder ? { hideRightBorder: true } : {}),
});
/** 한 줄 척도의 머리 — 1·3·3·3·1, 구간 사이 세로선 숨김 */
const bandHeader: HeaderCell[][] = [
  [
    head('전혀 만족하지 않음', 1, true),
    head('점1', 3, true),
    head('보통', 3, true),
    head('점2', 3, true),
    head('매우 만족함', 1),
  ],
];

function renderPiece(
  pieceSettings: MobilePieceSettings | undefined,
  {
    row = scaleRow(),
    cols = columns(),
    headerGrid = bandHeader,
  }: { row?: TableRow; cols?: TableColumn[]; headerGrid?: HeaderCell[][] | undefined } = {},
) {
  return render(
    <MobileOriginalRowTable
      columns={cols}
      rows={[row]}
      interactiveRowId="r1"
      headerGrid={headerGrid}
      hideColumnLabels={false}
      pieceSettings={pieceSettings}
      renderCell={(cell) => <span>{cell.id}</span>}
    />,
  );
}

/** 본문 격자의 열 폭(px) — 그리는 쪽이 실제로 쓴 값 */
function bodyTrackWidths(): number[] {
  const body = document.querySelector<HTMLElement>('[data-cell-id]')?.parentElement;
  if (!body) throw new Error('본문 격자가 없다');
  return body.style.gridTemplateColumns.split(' ').map((track) => Number.parseFloat(track));
}
const firstBodyCell = () => document.querySelector<HTMLElement>('[data-cell-id]')!;
const fitSlot = () => document.querySelector<HTMLElement>('[data-piece-columns-per-view]');
const overflowOf = (label: string) =>
  screen.getByText(label).closest<HTMLElement>('[data-header-overflow]')?.dataset['headerOverflow'];

describe('원본 표 조각 — 조각 한 화면 칸 수', () => {
  it('꺼진 조각은 원본 열 폭 그대로이고 마크업도 그대로다', () => {
    renderPiece(undefined);
    expect(bodyTrackWidths()).toEqual(Array.from({ length: 11 }, () => 100));
    expect(fitSlot()).toBeNull();
    expect(firstBodyCell().className).toContain('p-3');
    expect(document.querySelector('[data-header-overflow]')).toBeNull();
  });

  it('자리 폭 278 · 6칸 — 열한 칸이 모두 자리 폭의 1/6 이다', () => {
    renderPiece({ columnsPerView: 6 });
    const widths = bodyTrackWidths();

    expect(widths).toHaveLength(11);
    for (const width of widths) expect(width).toBeCloseTo(277 / 6, 3);
    // 여섯 칸이 왼쪽 테두리를 뺀 자리를 꽉 채운다
    expect(widths.slice(0, 6).reduce((sum, w) => sum + w, 0) + 1).toBeCloseTo(278, 3);
    expect(fitSlot()?.dataset['pieceColumnsPerView']).toBe('6');
  });

  it('폰이 넓어지면 같은 칸 수로 칸만 넓어진다', () => {
    slot.width = 308;
    renderPiece({ columnsPerView: 6 });
    for (const width of bodyTrackWidths()) expect(width).toBeCloseTo(307 / 6, 3);
  });

  it('머리 격자도 본문과 같은 열 폭을 쓴다', () => {
    renderPiece({ columnsPerView: 6 });
    const header = screen.getAllByRole('columnheader')[0]!.parentElement!;
    expect(header.style.gridTemplateColumns).toBe(firstBodyCell().parentElement!.style.gridTemplateColumns);
  });

  it('열 수가 칸 수 이하면 열 수로 나눠 자리를 꽉 채운다', () => {
    renderPiece({ columnsPerView: 6 }, { row: scaleRow(5), cols: columns(5), headerGrid: undefined });
    const widths = bodyTrackWidths();
    expect(widths).toHaveLength(5);
    expect(widths.reduce((sum, w) => sum + w, 0) + 1).toBeCloseTo(278, 3);
  });

  it('입력 칸이 섞인 조각은 원본 폭 그대로다', () => {
    const row: TableRow = {
      id: 'r1',
      label: '기타',
      cells: [choice(0), choice(1), { id: 'etc', type: 'input', content: '' }],
    };
    renderPiece({ columnsPerView: 6 }, { row, cols: columns(3), headerGrid: undefined });
    expect(bodyTrackWidths()).toEqual([100, 100, 100]);
    expect(fitSlot()).toBeNull();
  });

  it('자리 폭을 아직 못 쟀으면 원본 폭으로 둔다', () => {
    slot.width = 0;
    renderPiece({ columnsPerView: 6 });
    expect(bodyTrackWidths()).toEqual(Array.from({ length: 11 }, () => 100));
    expect(firstBodyCell().className).toContain('p-3');
  });

  it('좁은 칸 모드는 본문 칸의 좌우 여백을 줄인다', () => {
    renderPiece({ columnsPerView: 6 });
    expect(firstBodyCell().className).toContain('px-0.5');
    expect(firstBodyCell().className).not.toMatch(/(^|\s)p-3(\s|$)/);
  });

  it('반전과 함께 켜면 처음 여섯 칸이 ⑩ ~ ⑤ 다', () => {
    renderPiece({ columnsPerView: 6, reverseColumns: true });
    const ids = [...document.querySelectorAll<HTMLElement>('[data-cell-id]')].map(
      (el) => el.dataset['cellId'],
    );
    expect(ids.slice(0, 6)).toEqual(['c10', 'c9', 'c8', 'c7', 'c6', 'c5']);
    for (const width of bodyTrackWidths()) expect(width).toBeCloseTo(277 / 6, 3);
  });
});

describe('원본 표 조각 — 좁은 칸의 머리 글자 넘김', () => {
  it('세로선이 숨겨진 쪽으로 넘긴다 — 첫 칸은 오른쪽, 가운데는 양쪽, 끝 칸은 왼쪽', () => {
    renderPiece({ columnsPerView: 6 });
    expect(overflowOf('전혀 만족하지 않음')).toBe('right');
    expect(overflowOf('보통')).toBe('both');
    expect(overflowOf('매우 만족함')).toBe('left');
  });

  it('반전하면 방향도 따라 뒤집힌다 — 끝 이름이 조각 바깥으로 넘어가지 않는다', () => {
    renderPiece({ columnsPerView: 6, reverseColumns: true });
    const labels = screen.getAllByRole('columnheader').map((el) => el.textContent);
    expect(labels[0]).toBe('매우 만족함');
    expect(labels.at(-1)).toBe('전혀 만족하지 않음');

    expect(overflowOf('매우 만족함')).toBe('right');
    expect(overflowOf('전혀 만족하지 않음')).toBe('left');
  });

  it('세로선을 숨기지 않은 머리는 넘기지 않는다', () => {
    const plain: HeaderCell[][] = [[head('부정', 1), head('가운데', 9), head('긍정', 1)]];
    renderPiece({ columnsPerView: 6 }, { headerGrid: plain });
    expect(document.querySelector('[data-header-overflow]')).toBeNull();
  });

  it('한 화면 칸 수가 꺼진 조각은 반전만 켜도 머리 마크업이 그대로다', () => {
    renderPiece({ reverseColumns: true });
    expect(document.querySelector('[data-header-overflow]')).toBeNull();
    expect(screen.getAllByRole('columnheader')[0]!.className).toContain('px-4');
  });

  it('좁은 칸 모드의 머리 칸은 좌우 여백과 글자 크기를 줄인다', () => {
    renderPiece({ columnsPerView: 6 });
    const className = screen.getAllByRole('columnheader')[0]!.className;
    expect(className).toContain('px-1');
    expect(className).toContain('text-sm');
    expect(className).not.toContain('px-4');
  });
});
