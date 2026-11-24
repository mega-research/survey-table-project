import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  MOBILE_TABLE_DISPLAY_MODES,
  type MobileTableDisplayMode,
} from '@/types/mobile-table-display';
import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 표 문항 — 좁은 폭에서 보기 모양이 「척도 슬라이더」인 보기 그룹(CONTEXT.md 「척도 슬라이더」).
 *
 * 슬라이더로 그려지는 행이 있으면 「행 단위 그룹 카드」는 그 카드 안에서, 그 밖의 표시 방식은 전부 행 단위
 * 배치(「행별 척도」와 같이)로 그린다. 선택 쓰기는 그 그룹의 기존 채널 그대로다. 그 행에서 슬라이더를 못
 * 그리면 원본 한 줄로 떨어진다. 넓은 폭은 `-scale-slider` 파일이 본다.
 *
 * jsdom 은 배치를 계산하지 않으므로 트랙 범위는 테스트가 준다(왼쪽 100px · 폭 550px). 눈금 11개면 칸 하나가
 * 50px 이고 n번째 눈금(0부터)은 125 + 50n 에 선다.
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

/** 만족도 끝 칸에 상세 기재가 붙은 표 — 어느 행도 슬라이더로 그릴 수 없다 */
const fallbackRows: TableRow[] = rows.map((row) => ({
  ...row,
  cells: row.cells.map(
    (cell): TableCell => (cell.id === 'sat10' ? { ...cell, allowTextInput: true } : cell),
  ),
}));

function Harness({
  mode,
  satGroup = { scaleSlider: 'positive-right' },
  tableRows = rows,
}: {
  mode: MobileTableDisplayMode;
  satGroup?: Partial<ChoiceGroup>;
  tableRows?: TableRow[];
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
        rows={tableRows}
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
const sheet = () => screen.queryByTestId('mobile-row-wise-original-sheet');

/** 그 영역의 트랙 — 범위를 왼쪽 100px · 폭 550px 로 준다 */
function trackIn(container: HTMLElement): HTMLElement {
  const track = within(container).getByTestId('scale-slider-track');
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 650,
    width: 550,
    top: 0,
    bottom: 32,
    height: 32,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  return track;
}
const tickX = (n: number) => 125 + 50 * n;
const press = (track: HTMLElement, x: number) => {
  fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX: x });
  fireEvent.pointerUp(track, { pointerId: 1, button: 0, clientX: x });
};

describe('표 문항 — 좁은 폭의 척도 슬라이더: 「행 단위 그룹 카드」', () => {
  it('그 카드 안에서 슬라이더로 그리고 다른 그룹은 세로 타일 그대로다', () => {
    render(<Harness mode="row-group-cards" />);
    expect(sheet()).not.toBeInTheDocument();
    const section = screen.getByTestId('choice-group-section-g-sat');
    const slider = within(section).getByTestId('scale-slider-g-sat');
    expect(within(slider).getAllByRole('radio')).toHaveLength(11);
    // 구간 이름은 헤더에서 온다
    for (const label of ['매우 불만족', '불만족', '보통', '만족', '매우 만족']) {
      expect(within(slider).getByText(label)).toBeInTheDocument();
    }
    // 머리 줄에 섹션 제목(그룹 이름)이 선다 — 낭독 이름은 「카드 제목, 섹션 제목」이다
    expect(within(slider).getByText('만족도')).toBeInTheDocument();
    expect(within(slider).getByRole('radiogroup')).toHaveAccessibleName(/ 만족도$/);
    expect(screen.queryByTestId('choice-group-original-line-g-sat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scale-slider-g-use')).not.toBeInTheDocument();
    expect(screen.getByText('활용 안함', { selector: 'span' })).toBeInTheDocument();
  });

  it('눈금을 누르면 그 그룹 선택으로 저장되고, 다시 누르면 비워진다', () => {
    render(<Harness mode="row-group-cards" satGroup={{ scaleSlider: 'positive-left' }} />);
    const track = trackIn(screen.getByTestId('choice-group-section-g-sat'));
    press(track, tickX(7));
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat7' } });
    press(track, tickX(7));
    expect(valueOf().__choiceGroups).not.toHaveProperty('rad2');
  });

  it('척도 막대 필드가 함께 켜져 있어도 막대가 아니라 슬라이더다', () => {
    render(
      <Harness
        mode="row-group-cards"
        satGroup={{ scaleSlider: 'positive-right', mobileScaleBar: true }}
      />,
    );
    expect(screen.getByTestId('scale-slider-g-sat')).toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
  });

  it('그 행에서 슬라이더를 못 그리면 원본 한 줄이고 같은 그룹 선택으로 저장된다', () => {
    render(<Harness mode="row-group-cards" tableRows={fallbackRows} />);
    expect(screen.queryByTestId('scale-slider-g-sat')).not.toBeInTheDocument();
    const line = screen.getByTestId('choice-group-original-line-g-sat');
    expect(within(line).getAllByRole('radio')).toHaveLength(11);
    fireEvent.click(within(line).getByText('⑦'));
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat7' } });
  });
});

describe('표 문항 — 좁은 폭의 척도 슬라이더: 행 단위 배치', () => {
  it('「행별 척도」: 슬라이더 그룹은 슬라이더, 다른 그룹은 제 보기 모양(세로 타일)이다', () => {
    render(<Harness mode="row-wise-scale" />);
    const block = rowBlock('r1');
    // 활용 여부는 세로 타일(그룹 이름을 머리로), 만족도는 슬라이더(행에 묶음이 둘이라 그룹 이름이 머리)
    const tiles = within(block).getByRole('group', { name: '활용 여부' });
    expect(within(tiles).getAllByRole('radio')).toHaveLength(2);
    const slider = within(block).getByTestId('scale-slider-g-sat');
    // 낭독 이름은 「행 제목, 묶음 이름」이다 — 머리 줄에는 묶음 이름만 보인다
    expect(within(slider).getByText('만족도')).toBeInTheDocument();
    expect(within(slider).getByRole('radiogroup')).toHaveAccessibleName(/ 만족도$/);
    expect(within(slider).getAllByRole('radio')).toHaveLength(11);
    press(trackIn(block), tickX(7));
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat7' } });
  });

  it('표시 방식이 「행 단위 그룹 카드」가 아니면 무엇이든 행 단위 배치다', () => {
    for (const mode of MOBILE_TABLE_DISPLAY_MODES) {
      if (mode === 'row-group-cards') continue;
      const { unmount } = render(<Harness mode={mode} />);
      expect(sheet()).toBeInTheDocument();
      const block = rowBlock('r1');
      expect(within(block).getByTestId('scale-slider-g-sat')).toBeInTheDocument();
      // 「행별 척도」와 같이 — 슬라이더가 아닌 그룹은 좁은 화면에서 제 보기 모양(세로 타일)이다
      expect(within(block).getByRole('group', { name: '활용 여부' })).toBeInTheDocument();
      unmount();
    }
  });

  it('슬라이더로 그려지는 행이 없으면 고른 표시 방식 그대로다', () => {
    // 「자동」 — 종전의 카드 화면이고 행 단위 배치가 아니다
    const auto = render(<Harness mode="auto" tableRows={fallbackRows} />);
    expect(sheet()).not.toBeInTheDocument();
    expect(screen.queryByTestId('scale-slider-g-sat')).not.toBeInTheDocument();
    auto.unmount();

    // 「행별 척도」 — 시트는 그대로이고 그 그룹은 원본 표 조각이다
    render(<Harness mode="row-wise-scale" tableRows={fallbackRows} />);
    const block = rowBlock('r1');
    expect(within(block).queryByTestId('scale-slider-g-sat')).not.toBeInTheDocument();
    const tiles = within(block).getByRole('group', { name: '활용 여부' });
    const pieceRadios = within(block)
      .getAllByRole('radio')
      .filter((radio) => !tiles.contains(radio));
    expect(pieceRadios).toHaveLength(11);
    fireEvent.click(pieceRadios[7]!);
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'sat7' } });
  });

  it('슬라이더 설정이 없는 표는 좁은 폭에서도 고른 표시 방식 그대로다', () => {
    render(<Harness mode="row-wise-scale" satGroup={{}} />);
    expect(screen.queryByTestId('scale-slider-g-sat')).not.toBeInTheDocument();
    // 두 그룹 다 세로 타일
    expect(within(rowBlock('r1')).getByRole('group', { name: '만족도' })).toBeInTheDocument();
  });
});
