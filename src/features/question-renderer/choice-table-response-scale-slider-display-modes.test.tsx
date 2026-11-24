import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  MOBILE_TABLE_DISPLAY_MODES,
  type MobileTableDisplayMode,
} from '@/types/mobile-table-display';
import type { ChoiceGroup, Question, TableCell, TableColumn, TableRow } from '@/types/survey';

import { ChoiceTableResponse } from './choice-table-response';

/**
 * 보기 소스 표(radio 문항 + 내장 표) — 좁은 폭에서 척도 슬라이더가 배치를 가져간 표를 모바일 표시 방식
 * 아홉 가지로 그린다(CONTEXT.md 「척도 슬라이더」 · 「모바일 표시 방식」).
 *
 * 슬라이더로 그려지는 행이 있으면 「행 단위 그룹 카드」만 그 카드 안에서, 그 밖은 저작자가 고른 방식과
 * 무관하게 행 단위 배치다. 그때 저작자가 고른 방식의 전용 장치·상태(선택 행 원본 보기의 상세 · 축 단위
 * 카드 · 자동/행 카드 · 원본 표)가 화면에 남으면 안 된다 — 표 문항 쪽 짝은
 * `interactive-table-response-scale-slider-display-modes` 다. 여덟 방식의 화면을 「행별 척도」의 화면과
 * 통째로 견준다.
 *
 * 이 호스트에는 행 차례로 열기가 없다(표 문항 전용). 필수 강조와 값 쓰기를 본다.
 *
 * jsdom 은 배치를 계산하지 않으므로 트랙 범위는 테스트가 준다(왼쪽 100px · 폭 500px). 눈금 5개면 칸 하나가
 * 100px 이고 눈금은 150 · 250 · 350 · 450 · 550 에 선다.
 */

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
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
  vi.restoreAllMocks();
});

const NAMES = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
const CIRC = ['①', '②', '③', '④', '⑤'];

// 구분 | 활용 여부 2칸 | 만족도 5칸
const columns: TableColumn[] = [
  { id: 'item', label: '구분', width: 190 },
  { id: 'use1', label: '활용함', width: 70 },
  { id: 'use2', label: '활용 안함', width: 70 },
  ...NAMES.map((label, n) => ({ id: `s${n}`, label, width: 80 })),
];

/** 그룹 있는 표의 행 — 활용 여부(세로 타일)와 만족도(슬라이더), 행마다 그룹이 따로다 */
function groupedRow(id: string, title: string): TableRow {
  return {
    id,
    label: title,
    cells: [
      { id: `${id}-item`, type: 'text', content: title },
      {
        id: `${id}-use1`,
        type: 'choice_opt',
        content: '①',
        choiceLabel: '활용함',
        choiceGroupId: `g-use-${id}`,
      },
      {
        id: `${id}-use2`,
        type: 'choice_opt',
        content: '②',
        choiceLabel: '활용 안함',
        choiceGroupId: `g-use-${id}`,
      },
      ...CIRC.map(
        (content, n): TableCell => ({
          id: `${id}-sat${n}`,
          type: 'choice_opt',
          content,
          choiceLabel: NAMES[n]!,
          choiceGroupId: `g-sat-${id}`,
        }),
      ),
    ],
  };
}

const groupedRows: TableRow[] = [
  groupedRow('r1', '1) 주차/접근성'),
  groupedRow('r2', '2) 도보통행 편의성'),
];
const groupedChoiceGroups: ChoiceGroup[] = groupedRows.flatMap((row) => [
  { id: `g-use-${row.id}`, groupKey: `use_${row.id}`, type: 'radio', label: '활용 여부' },
  {
    id: `g-sat-${row.id}`,
    groupKey: `sat_${row.id}`,
    type: 'radio',
    label: '만족도',
    scaleSlider: 'positive-right',
  },
]);

function groupedQuestion(mode: MobileTableDisplayMode): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '시설 만족도',
    required: false,
    order: 0,
    mobileTableDisplayMode: mode,
    mobileDrilldownOmitLeadingColumns: 1,
    choiceGroups: groupedChoiceGroups,
    tableColumns: columns,
    tableRowsData: groupedRows,
  } as unknown as Question;
}

/** 그룹 없는 표 — 척도 한 줄, 문항 설정이 슬라이더를 켠다 */
function ungroupedQuestion(mode: MobileTableDisplayMode): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '전반적으로 얼마나 만족하십니까?',
    required: false,
    order: 0,
    mobileTableDisplayMode: mode,
    mobileDrilldownOmitLeadingColumns: 1,
    scaleSlider: 'positive-right',
    tableColumns: [columns[0]!, ...columns.slice(3)],
    tableRowsData: [
      {
        id: 'r1',
        label: '전반적 만족도',
        cells: [
          { id: 'r1-item', type: 'text', content: '전반적 만족도' },
          ...CIRC.map(
            (content, n): TableCell => ({
              id: `r1-sat${n}`,
              type: 'choice_opt',
              content,
              choiceLabel: NAMES[n]!,
            }),
          ),
        ],
      },
    ],
  } as unknown as Question;
}

/** r2 만족도 그룹 — 필수인데 답하지 않은 그룹으로 넘긴다 */
const R2_SCALE_CELL_IDS = CIRC.map((_, n) => `r2-sat${n}`);

function Harness({ q, unfilled }: { q: Question; unfilled?: Set<string> | undefined }) {
  const [value, setValue] = useState<unknown>(undefined);
  return (
    <>
      <ChoiceTableResponse
        question={q}
        value={value}
        onChange={setValue}
        {...(unfilled ? { unfilledGroupCellIds: unfilled } : {})}
      />
      <output data-testid="value">{JSON.stringify(value ?? null)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);
const sheet = () => screen.queryByTestId('mobile-row-wise-original-sheet');

function trackIn(slider: HTMLElement): HTMLElement {
  const track = within(slider).getByTestId('scale-slider-track');
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 600,
    width: 500,
    top: 0,
    bottom: 32,
    height: 32,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  return track;
}
const TICK_X = [150, 250, 350, 450, 550];
const press = (track: HTMLElement, x: number) => {
  fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX: x });
  fireEvent.pointerUp(track, { pointerId: 1, button: 0, clientX: x });
};

/**
 * 화면 글자 — 렌더마다 달라지는 React id(useId)는 처음 나온 순서의 번호로 바꿔 두 렌더를 견줄 수 있게 한다.
 * 견본 표의 저작 id 에는 이 모양이 없다.
 */
function screenHtml(container: HTMLElement): string {
  const seen = new Map<string, string>();
  return container.innerHTML.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, (id) => {
    if (!seen.has(id)) seen.set(id, `id${seen.size}`);
    return seen.get(id)!;
  });
}

/** 한 방식으로 그려 응답자의 걸음을 밟고, 걸음마다 화면을 적어 둔다 */
function walk(q: Question, sliderTestId: string, unfilled?: Set<string>): string[] {
  const { container, unmount } = render(<Harness q={q} unfilled={unfilled} />);
  const shots = [screenHtml(container)];
  press(trackIn(screen.getByTestId(sliderTestId)), TICK_X[3]!);
  shots.push(screenHtml(container));
  unmount();
  return shots;
}

const ROW_WISE_MODES = MOBILE_TABLE_DISPLAY_MODES.filter((mode) => mode !== 'row-group-cards');

describe('보기 소스 표 — 좁은 폭 × 모바일 표시 방식 아홉 가지 × 척도 슬라이더(그룹 있는 표)', () => {
  it.each(ROW_WISE_MODES)('「%s」: 행 단위 배치가 그려지고 그 방식의 전용 장치가 남지 않는다', (mode) => {
    render(<Harness q={groupedQuestion(mode)} />);
    expect(sheet()).toBeInTheDocument();
    expect(within(sheet()!).getByTestId('scale-slider-g-sat-r1')).toBeInTheDocument();
    expect(within(sheet()!).getByTestId('scale-slider-g-sat-r2')).toBeInTheDocument();
    // 응답 칸은 전부 시트 안에 있다 — 다른 화면(선택 행 원본 보기 · 축 카드 · 행 카드 · 원본 표)이 함께 서지 않는다
    for (const radio of screen.getAllByRole('radio')) {
      expect(sheet()!.contains(radio)).toBe(true);
    }
    expect(screen.queryByTestId(/^choice-group-section-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^row-card-/)).not.toBeInTheDocument();
    // 시트 밖에는 버튼이 없다(선택 행 원본 보기의 목록·이동 버튼이 없다)
    expect(screen.queryAllByRole('button').filter((button) => !sheet()!.contains(button))).toEqual(
      [],
    );
  });

  it('여덟 방식의 화면이 「행별 척도」와 같다 — 처음 · 답한 뒤', () => {
    const unfilled = new Set(R2_SCALE_CELL_IDS);
    const baseline = walk(groupedQuestion('row-wise-scale'), 'scale-slider-g-sat-r1', unfilled);
    expect(baseline).toHaveLength(2);
    for (const mode of ROW_WISE_MODES) {
      const shots = walk(groupedQuestion(mode), 'scale-slider-g-sat-r1', unfilled);
      shots.forEach((shot, step) => {
        expect(shot === baseline[step], `${mode} · ${step}번째 걸음`).toBe(true);
      });
    }
  });

  it.each(ROW_WISE_MODES)('「%s」: 필수 강조와 값 쓰기가 동작한다', (mode) => {
    render(<Harness q={groupedQuestion(mode)} unfilled={new Set(R2_SCALE_CELL_IDS)} />);
    const r1 = screen.getByTestId('scale-slider-g-sat-r1');
    const r2 = screen.getByTestId('scale-slider-g-sat-r2');
    expect(within(r2).getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
    expect(within(r1).getByRole('radiogroup')).not.toHaveAttribute('aria-invalid', 'true');
    press(trackIn(r1), TICK_X[3]!);
    expect(valueOf()).toEqual({ sat_r1: 'r1-sat3' });
    // 슬라이더가 아닌 그룹(세로 타일)도 같은 그룹 맵에 쓰인다
    fireEvent.click(screen.getAllByText('활용함', { selector: 'span' })[1]!);
    expect(valueOf()).toEqual({ sat_r1: 'r1-sat3', use_r2: 'r2-use1' });
  });

  it('「행 단위 그룹 카드」: 그 카드 안에서 슬라이더로 그리고 필수 강조와 값 쓰기가 동작한다', () => {
    render(
      <Harness q={groupedQuestion('row-group-cards')} unfilled={new Set(R2_SCALE_CELL_IDS)} />,
    );
    expect(sheet()).not.toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    const r1 = within(screen.getByTestId('choice-group-section-g-sat-r1')).getByTestId(
      'scale-slider-g-sat-r1',
    );
    const r2 = screen.getByTestId('scale-slider-g-sat-r2');
    expect(within(r2).getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
    press(trackIn(r1), TICK_X[3]!);
    expect(valueOf()).toEqual({ sat_r1: 'r1-sat3' });
  });
});

describe('보기 소스 표 — 좁은 폭 × 모바일 표시 방식 아홉 가지 × 척도 슬라이더(그룹 없는 표, 문항 설정)', () => {
  const SLIDER = 'scale-slider-run:r1-sat0';

  it.each(ROW_WISE_MODES)('「%s」: 행 단위 배치가 그려지고 값이 쓰인다', (mode) => {
    render(<Harness q={ungroupedQuestion(mode)} />);
    expect(sheet()).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) {
      expect(sheet()!.contains(radio)).toBe(true);
    }
    expect(screen.queryByTestId(/^row-card-/)).not.toBeInTheDocument();
    press(trackIn(within(sheet()!).getByTestId(SLIDER)), TICK_X[3]!);
    expect(valueOf()).toBe('r1-sat3');
  });

  it('여덟 방식의 화면이 「행별 척도」와 같다 — 처음 · 답한 뒤', () => {
    const baseline = walk(ungroupedQuestion('row-wise-scale'), SLIDER);
    for (const mode of ROW_WISE_MODES) {
      const shots = walk(ungroupedQuestion(mode), SLIDER);
      shots.forEach((shot, step) => {
        expect(shot === baseline[step], `${mode} · ${step}번째 걸음`).toBe(true);
      });
    }
  });

  it('「행 단위 그룹 카드」: 그 카드 안에서 슬라이더로 그리고 값이 쓰인다', () => {
    render(<Harness q={ungroupedQuestion('row-group-cards')} />);
    expect(sheet()).not.toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    const slider = document.querySelector<HTMLElement>('[data-testid^="scale-slider-"]')!;
    press(trackIn(slider), TICK_X[3]!);
    expect(valueOf()).toBe('r1-sat3');
  });
});
