import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 표 문항 — 조각 좌우 반전(원본 행 상세 설정). 좁은 화면의 「행별 원본 문항 보기」에서 원본 표 조각의 점수 칸이
 * 작성 순서의 반대로 서고, 「평균에서 제외」 칸은 끝에 남는다. 응답은 원래 칸 id 로 쓰인다.
 * 형사사법포털 이용자 만족도 조사 B2(항목마다 ⓪~⑩ + 해당없음, 행마다 보기 그룹).
 */

const view = vi.hoisted(() => ({ mobile: true }));
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => view.mobile,
  useMediaQuery: () => view.mobile,
}));

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
afterEach(() => {
  view.mobile = true;
});

const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const ITEMS = ['회원가입 절차가 편리하다.', '응답 속도는 적정하다.'];
const head = (id: string, label: string, colspan: number, hideRightBorder = false): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan: 1,
  ...(hideRightBorder ? { hideRightBorder: true } : {}),
});
const headerGrid: HeaderCell[][] = [
  [
    head('h-item', '평가요소', 1),
    head('h-neg', '전혀 그렇지 않다', 2, true),
    head('h-d1', '· · ·', 2, true),
    head('h-mid', '보통', 3, true),
    head('h-d2', '· · · ·', 2, true),
    head('h-pos', '매우 그렇다', 2),
    head('h-na', '해당없음', 1),
  ],
];
const columns: TableColumn[] = [
  { id: 'item', label: '평가요소', width: 456 },
  ...CIRC.map((_, n) => ({ id: `s${n}`, label: `${n}점`, width: 52 })),
  { id: 'na', label: '해당없음', width: 70 },
];
const groups = (extra: Partial<ChoiceGroup> = {}): ChoiceGroup[] =>
  ITEMS.map((_, i) => ({
    id: `g${i + 1}`,
    groupKey: `rad${i + 1}`,
    type: 'radio',
    label: '',
    ...extra,
  }));
const scaleCells = (rowIndex: number): TableCell[] => [
  ...CIRC.map((content, n) => ({
    id: `r${rowIndex + 1}-c${n}`,
    type: 'choice_opt' as const,
    content,
    choiceLabel: `${n}점`,
    choiceGroupId: `g${rowIndex + 1}`,
  })),
  {
    id: `r${rowIndex + 1}-na`,
    type: 'choice_opt' as const,
    content: '',
    choiceLabel: '해당없음',
    choiceGroupId: `g${rowIndex + 1}`,
    excludeFromMean: true,
  },
];
const rows: TableRow[] = ITEMS.map((item, i) => ({
  id: `r${i + 1}`,
  label: item,
  cells: [{ id: `r${i + 1}-item`, type: 'text', content: item }, ...scaleCells(i)],
}));

const AUTHORED = [...CIRC.map((_, n) => `r1-c${n}`), 'r1-na'];
const REVERSED = [...CIRC.map((_, n) => `r1-c${n}`).reverse(), 'r1-na'];

function Harness({
  mode = 'row-wise-original',
  reverse,
  groupsOverride,
  errorCellIds,
}: {
  mode?: MobileTableDisplayMode;
  reverse?: boolean;
  groupsOverride?: ChoiceGroup[];
  errorCellIds?: Set<string>;
}) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        tableHeaderGrid={headerGrid}
        choiceGroups={groupsOverride ?? groups()}
        mobileTableDisplayMode={mode}
        mobileDrilldownOmitLeadingColumns={1}
        mobileDrilldownReverseColumns={reverse}
        value={value}
        onChange={setValue}
        errorCellIds={errorCellIds}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const rowBlock = (rowId: string) => {
  const block = document.querySelector<HTMLElement>(`[data-row-question-id="${rowId}"]`);
  if (!block) throw new Error(`행 블록 ${rowId} 가 없다`);
  return block;
};
/** 그 행 조각에 그려진 본문 칸의 id — DOM 순서(= 화면에 놓인 순서 = Tab·방향키 순서) */
const pieceCellIds = (rowId: string) =>
  [...rowBlock(rowId).querySelectorAll<HTMLElement>('[data-cell-id]')].map(
    (el) => el.dataset['cellId'],
  );
const headerLabels = (rowId: string) =>
  within(rowBlock(rowId))
    .getAllByRole('columnheader')
    .map((el) => el.textContent);

describe('표 문항 — 조각 좌우 반전 (행별 원본 문항 보기)', () => {
  it('끈 문항은 작성 순서 그대로다', () => {
    render(<Harness />);
    expect(pieceCellIds('r1')).toEqual(AUTHORED);
    expect(headerLabels('r1')).toEqual([
      '전혀 그렇지 않다',
      '· · ·',
      '보통',
      '· · · ·',
      '매우 그렇다',
      '해당없음',
    ]);
  });

  it('false 로 끈 문항도 작성 순서 그대로다', () => {
    render(<Harness reverse={false} />);
    expect(pieceCellIds('r1')).toEqual(AUTHORED);
  });

  it('켠 문항은 점수 칸이 뒤집히고 「평균에서 제외」 칸은 끝에 남는다', () => {
    render(<Harness reverse />);
    expect(pieceCellIds('r1')).toEqual(REVERSED);
    expect(pieceCellIds('r2')).toEqual(REVERSED.map((id) => id.replace('r1-', 'r2-')));
  });

  it('머리 구간도 뒤집힌 칸과 같은 순서로 선다', () => {
    render(<Harness reverse />);
    expect(headerLabels('r1')).toEqual([
      '매우 그렇다',
      '· · · ·',
      '보통',
      '· · ·',
      '전혀 그렇지 않다',
      '해당없음',
    ]);
  });

  it('뒤집힌 칸을 누르면 원래 칸 id 로 응답이 쓰인다', () => {
    render(<Harness reverse />);
    const radios = within(rowBlock('r1')).getAllByRole('radio');

    // 화면의 첫 칸은 ⑩ 이다
    expect(radios[0]).toHaveAccessibleName('10점');
    fireEvent.click(radios[0]!);
    expect(screen.getByTestId('value')).toHaveTextContent(JSON.stringify({ rad1: 'r1-c10' }));

    fireEvent.click(within(rowBlock('r1')).getByRole('radio', { name: '해당없음' }));
    expect(screen.getByTestId('value')).toHaveTextContent(JSON.stringify({ rad1: 'r1-na' }));
  });

  it('그려지는 칸의 집합은 반전과 무관하다 — 보이는 칸이 늘거나 줄지 않는다', () => {
    const { unmount } = render(<Harness />);
    const off = [...pieceCellIds('r1')].sort();
    unmount();
    render(<Harness reverse />);
    expect([...pieceCellIds('r1')].sort()).toEqual(off);
  });

  it('셀 표시 인스턴스 id 와 오류 칸 표시는 칸 id 를 따라간다', () => {
    render(<Harness reverse errorCellIds={new Set(['r1-c10'])} />);
    const first = rowBlock('r1').querySelector<HTMLElement>('[data-cell-id="r1-c10"]');
    expect(first?.dataset['cellInstanceId']).toBe('r1:r1:r1-c10');
    expect(first?.className).toMatch(/ring-red/);
  });
});

describe('표 문항 — 조각 좌우 반전이 적용되지 않는 곳', () => {
  it('PC(넓은 화면) 표는 켜도 작성 순서 그대로다', () => {
    view.mobile = false;
    render(<Harness reverse />);
    const ids = [...document.querySelectorAll<HTMLElement>('[data-row-id="r1"][data-cell-id]')].map(
      (el) => el.dataset['cellId'],
    );
    expect(ids.filter((id) => id !== 'r1-item')).toEqual(AUTHORED);
  });

  it('「행별 척도」의 척도 막대는 켜도 순서가 바뀌지 않는다', () => {
    const barLabels = () =>
      within(screen.getByTestId('choice-group-scale-bar-g1'))
        .getAllByRole('radio')
        .map((el) => el.getAttribute('aria-label') ?? el.textContent);

    const barGroups = groups({ mobileScaleBar: true });
    const { unmount } = render(<Harness mode="row-wise-scale" groupsOverride={barGroups} />);
    const off = barLabels();
    unmount();

    render(<Harness mode="row-wise-scale" groupsOverride={barGroups} reverse />);
    expect(barLabels()).toEqual(off);
  });
});
