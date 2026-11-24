import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import type { ChoiceGroup, HeaderCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 표 문항 — 보기 모양이 「척도 슬라이더」인 보기 그룹. 슬라이더를 그릴 수 있기 전까지는 「못 그리는 묶음」과
 * 같이 원본 한 줄(그 그룹 열만 잘라 낸 원본 표 조각)로 그리고, 선택 쓰기는 그 그룹의 기존 채널 그대로다.
 * 슬라이더 조각이 생기면 이 파일의 기대가 바뀐다.
 */

const view = vi.hoisted(() => ({ mobile: true }));
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => view.mobile,
  useMediaQuery: () => view.mobile,
}));
vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
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
const columns: TableColumn[] = [
  { id: 'item', label: '평가항목', width: 190 },
  { id: 'use1', label: '활용함', width: 70 },
  { id: 'use2', label: '활용 안함', width: 64 },
  ...CIRC.map((_, n) => ({ id: `s${n}`, label: `${n}점`, width: 64 })),
];
const head = (id: string, label: string, colspan: number, rowspan = 1): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan,
});
const headerGrid: HeaderCell[][] = [
  [head('h-item', '평가항목', 1, 2), head('h-use', '활용 여부', 2), head('h-sat', '만족도', 11)],
  [
    head('h-u1', '활용함', 1),
    head('h-u2', '활용 안함', 1),
    head('h-0', '매우 불만족', 1),
    head('h-neg', '불만족', 4),
    head('h-5', '보통', 1),
    head('h-pos', '만족', 4),
    head('h-10', '매우 만족', 1),
  ],
];
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '회의실 및 교통비 지원',
    cells: [
      { id: 'item', type: 'text', content: '1) 회의실 및 교통비 지원' },
      { id: 'use1', type: 'choice_opt', content: '①', choiceLabel: '활용함', choiceGroupId: 'g-use' },
      { id: 'use2', type: 'choice_opt', content: '②', choiceLabel: '활용 안함', choiceGroupId: 'g-use' },
      ...CIRC.map((content, n) => ({
        id: `sat${n}`,
        type: 'choice_opt' as const,
        content,
        choiceLabel: `${n}점`,
        choiceGroupId: 'g-sat',
      })),
    ],
  },
];

function Harness({
  mode,
  satGroup = { scaleSlider: 'positive-right' },
}: {
  mode: MobileTableDisplayMode;
  satGroup?: Partial<ChoiceGroup>;
}) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  const groups: ChoiceGroup[] = [
    { id: 'g-use', groupKey: 'rad1', type: 'radio', label: '활용 여부' },
    { id: 'g-sat', groupKey: 'rad2', type: 'radio', label: '만족도', ...satGroup },
  ];
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        tableHeaderGrid={headerGrid}
        choiceGroups={groups}
        mobileTableDisplayMode={mode}
        mobileDrilldownOmitLeadingColumns={1}
        value={value}
        onChange={setValue}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);
const rowBlock = (rowId: string) =>
  document.querySelector<HTMLElement>(`[data-row-question-id="${rowId}"]`)!;

describe('표 문항 — 척도 슬라이더를 고른 그룹(슬라이더 조각이 생기기 전)', () => {
  it('「행 단위 그룹 카드」: 그 그룹을 원본 한 줄로 그리고 다른 그룹은 세로 타일 그대로다', () => {
    render(<Harness mode="row-group-cards" />);
    const line = screen.getByTestId('choice-group-original-line-g-sat');
    for (const label of ['만족도', '매우 불만족', '불만족', '보통', '만족', '매우 만족']) {
      expect(within(line).getByText(label)).toBeInTheDocument();
    }
    expect(within(line).getAllByRole('radio')).toHaveLength(11);
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-original-line-g-use')).not.toBeInTheDocument();
    expect(screen.getByText('활용 안함', { selector: 'span' })).toBeInTheDocument();
  });

  it('「행 단위 그룹 카드」: 한 줄의 칸을 누르면 그 그룹 선택으로 저장된다', () => {
    render(<Harness mode="row-group-cards" satGroup={{ scaleSlider: 'positive-left' }} />);
    fireEvent.click(within(screen.getByTestId('choice-group-original-line-g-sat')).getByText('⑦'));
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat7' } });
  });

  it('「행 단위 그룹 카드」: 척도 막대 필드가 함께 켜져 있어도 막대가 아니라 원본 한 줄이다', () => {
    render(
      <Harness
        mode="row-group-cards"
        satGroup={{ scaleSlider: 'positive-right', mobileScaleBar: true }}
      />,
    );
    expect(screen.getByTestId('choice-group-original-line-g-sat')).toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
  });

  it('「행별 척도」: 그 그룹 열의 원본 표 조각으로 그리고 같은 그룹 선택으로 저장된다', () => {
    render(<Harness mode="row-wise-scale" />);
    const block = rowBlock('r1');
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    // 활용 여부는 세로 타일(그룹 이름을 머리로), 만족도는 타일도 막대도 아닌 원본 조각의 라디오 11개
    const tiles = within(block).getByRole('group', { name: '활용 여부' });
    expect(within(tiles).getAllByRole('radio')).toHaveLength(2);
    expect(within(block).queryByRole('group', { name: '만족도' })).not.toBeInTheDocument();
    const pieceRadios = within(block)
      .getAllByRole('radio')
      .filter((radio) => !tiles.contains(radio));
    expect(pieceRadios).toHaveLength(11);
    fireEvent.click(pieceRadios[7]!);
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat7' } });
  });

  it('데스크톱 폭에서는 원본 표 그대로다', () => {
    view.mobile = false;
    render(<Harness mode="row-wise-scale" />);
    expect(screen.queryByTestId('mobile-row-wise-original-sheet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-original-line-g-sat')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(13);
  });
});
