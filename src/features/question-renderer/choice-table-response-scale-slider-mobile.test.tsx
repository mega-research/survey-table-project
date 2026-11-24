import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/mobile-table-display';
import type { ChoiceGroup, Question } from '@/types/survey';

import { ChoiceTableResponse } from './choice-table-response';

/**
 * 보기 소스 표(radio 문항 + 내장 표) — 좁은 폭에서 보기 모양이 「척도 슬라이더」인 보기 그룹
 * (CONTEXT.md 「척도 슬라이더」).
 *
 * 표시 방식이 「행 단위 그룹 카드」면 그 카드 안에서, 그 밖에는 무엇을 골랐든 행 단위 배치(「행별 척도」와
 * 같이)로 그린다. 다른 그룹은 제 보기 모양 그대로다. 선택 쓰기는 이 문항의 그룹 맵 그대로다.
 * 넓은 폭은 `-scale-slider`, 그룹 없는 표(문항 설정)는 `-scale-slider-ungrouped` 파일이 본다.
 *
 * jsdom 은 배치를 계산하지 않으므로 트랙 범위는 테스트가 준다(왼쪽 100px · 폭 550px). 눈금 11개면 칸
 * 하나가 50px 이고 n번째 눈금은 125 + 50n 에 선다.
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

function question(
  mode: Question['mobileTableDisplayMode'],
  satGroup: Partial<ChoiceGroup> = { scaleSlider: 'positive-right' },
): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '지원제도',
    required: false,
    order: 0,
    mobileTableDisplayMode: mode,
    mobileDrilldownOmitLeadingColumns: 1,
    choiceGroups: [
      { id: 'g-use', type: 'radio', groupKey: 'rad1', label: '활용 여부' },
      { id: 'g-sat', type: 'radio', groupKey: 'rad2', label: '만족도', ...satGroup },
    ],
    tableColumns: [
      { id: 'c-item', label: '평가항목' },
      { id: 'c-u1', label: '활용함' },
      { id: 'c-u2', label: '활용 안함' },
      ...CIRC.map((_, n) => ({ id: `c-s${n}`, label: `${n}점` })),
    ],
    tableHeaderGrid: [
      [
        { id: 'h-item', label: '평가항목', colspan: 1, rowspan: 2 },
        { id: 'h-use', label: '활용 여부', colspan: 2, rowspan: 1 },
        { id: 'h-sat', label: '만족도', colspan: 11, rowspan: 1 },
      ],
      [
        { id: 'h-u1', label: '활용함', colspan: 1, rowspan: 1 },
        { id: 'h-u2', label: '활용 안함', colspan: 1, rowspan: 1 },
        { id: 'h-0', label: '매우 불만족', colspan: 1, rowspan: 1 },
        { id: 'h-neg', label: '불만족', colspan: 4, rowspan: 1 },
        { id: 'h-5', label: '보통', colspan: 1, rowspan: 1 },
        { id: 'h-pos', label: '만족', colspan: 4, rowspan: 1 },
        { id: 'h-10', label: '매우 만족', colspan: 1, rowspan: 1 },
      ],
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '회의실 및 교통비 지원',
        cells: [
          { id: 'item', type: 'text', content: '1) 회의실 및 교통비 지원' },
          { id: 'u1', type: 'choice_opt', content: '①', choiceLabel: '활용함', choiceGroupId: 'g-use' },
          { id: 'u2', type: 'choice_opt', content: '②', choiceLabel: '활용 안함', choiceGroupId: 'g-use' },
          ...CIRC.map((content, n) => ({
            id: `sat${n}`,
            type: 'choice_opt' as const,
            content,
            choiceLabel: `${n}점`,
            choiceGroupId: 'g-sat',
          })),
        ],
      },
    ],
  } as unknown as Question;
}

function Harness({ q }: { q: Question }) {
  const [value, setValue] = useState<unknown>(undefined);
  return (
    <>
      <ChoiceTableResponse question={q} value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value ?? null)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);
const rowBlock = (rowId: string) =>
  document.querySelector<HTMLElement>(`[data-row-question-id="${rowId}"]`)!;

const slider = () => screen.queryByTestId('scale-slider-g-sat');

/** 만족도 트랙 — 범위를 왼쪽 100px · 폭 550px 로 준다(눈금 11개, 칸 하나 50px) */
function track(): HTMLElement {
  const el = within(slider()!).getByTestId('scale-slider-track');
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
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
  return el;
}
const tickX = (n: number) => 125 + 50 * n;
const press = (el: HTMLElement, x: number) => {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: x });
  fireEvent.pointerUp(el, { pointerId: 1, button: 0, clientX: x });
};

/** 상세 기재 보기가 낀 만족도 그룹 — 슬라이더로 그릴 수 없다 */
function fallbackQuestion(mode: Question['mobileTableDisplayMode']): Question {
  const q = question(mode);
  q.tableRowsData = q.tableRowsData!.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => (cell.id === 'sat10' ? { ...cell, allowTextInput: true } : cell)),
  }));
  return q;
}

describe('보기 소스 표 — 좁은 폭의 척도 슬라이더(행 단위 그룹 카드)', () => {
  it('그 카드 안에서 슬라이더로 그리고 다른 그룹은 세로 타일 그대로다', () => {
    render(<Harness q={question('row-group-cards')} />);
    expect(screen.queryByTestId('mobile-row-wise-original-sheet')).not.toBeInTheDocument();
    const section = screen.getByTestId('choice-group-section-g-sat');
    expect(within(section).getByTestId('scale-slider-g-sat')).toBeInTheDocument();
    expect(within(section).getAllByRole('radio')).toHaveLength(11);
    // 머리 줄의 섹션 제목과 구간 타일
    expect(within(section).getByText('만족도')).toBeInTheDocument();
    expect(section.querySelectorAll('[data-tile="band"]')).toHaveLength(5);
    expect(screen.queryByTestId('choice-group-original-line-g-sat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    // 다른 그룹은 세로 타일
    expect(screen.queryByTestId('choice-group-original-line-g-use')).not.toBeInTheDocument();
    expect(screen.getByText('활용 안함', { selector: 'span' })).toBeInTheDocument();
  });

  it('트랙을 누르면 그룹 맵에 셀 id 가 들어가고, 다시 누르면 비워진다', () => {
    render(<Harness q={question('row-group-cards', { scaleSlider: 'positive-left' })} />);
    expect(within(slider()!).queryByTestId('scale-slider-thumb')).not.toBeInTheDocument();
    press(track(), tickX(7));
    expect(valueOf()).toEqual({ rad2: 'sat7' });
    // 고른 자리에 손잡이가 서고 그 눈금의 라디오가 골라진다
    expect(within(slider()!).getByTestId('scale-slider-thumb')).toBeInTheDocument();
    expect(within(slider()!).getAllByRole('radio')[7]).toBeChecked();
    press(track(), tickX(7));
    expect(valueOf()).toEqual({});
    expect(within(slider()!).queryByTestId('scale-slider-thumb')).not.toBeInTheDocument();
  });

  it('척도 막대 필드가 함께 켜져 있어도 막대가 아니라 슬라이더다', () => {
    render(
      <Harness
        q={question('row-group-cards', { scaleSlider: 'positive-right', mobileScaleBar: true })}
      />,
    );
    expect(slider()).toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
  });

  it('미충족 필수 그룹의 슬라이더가 강조된다', () => {
    const q = question('row-group-cards');
    render(
      <ChoiceTableResponse
        question={q}
        value={undefined}
        onChange={() => {}}
        unfilledGroupCellIds={new Set(CIRC.map((_, n) => `sat${n}`))}
      />,
    );
    expect(within(slider()!).getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
  });

  it('슬라이더로 그릴 수 없는 그룹은 종전 사슬대로 원본 한 줄이다', () => {
    render(<Harness q={fallbackQuestion('row-group-cards')} />);
    expect(slider()).not.toBeInTheDocument();
    expect(screen.getByTestId('choice-group-original-line-g-sat')).toBeInTheDocument();
  });
});

describe('보기 소스 표 — 좁은 폭의 척도 슬라이더(행 단위 배치)', () => {
  it('표시 방식이 「행 단위 그룹 카드」가 아니면 무엇이든 행 단위 배치다', () => {
    for (const mode of MOBILE_TABLE_DISPLAY_MODES) {
      if (mode === 'row-group-cards') continue;
      const { unmount } = render(<Harness q={question(mode)} />);
      expect(screen.getByTestId('mobile-row-wise-original-sheet'), mode).toBeInTheDocument();
      expect(within(rowBlock('r1')).getByTestId('scale-slider-g-sat'), mode).toBeInTheDocument();
      unmount();
    }
  });

  it('「행별 척도」: 슬라이더 그룹은 슬라이더, 다른 그룹은 제 보기 모양(세로 타일)이다', () => {
    render(<Harness q={question('row-wise-scale')} />);
    const block = rowBlock('r1');
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    const tiles = within(block).getByRole('group', { name: '활용 여부' });
    expect(within(tiles).getAllByRole('radio')).toHaveLength(2);
    const sliderRadios = within(slider()!).getAllByRole('radio');
    expect(sliderRadios).toHaveLength(11);
    // 원본 표 조각은 없다 — 응답 칸이 전부 타일과 슬라이더에 들었다
    expect(within(block).queryByRole('grid')).not.toBeInTheDocument();
    // 한 행에 응답 묶음이 둘이라 슬라이더 머리에 그룹 이름이 선다
    expect(within(slider()!).getByText('만족도')).toBeInTheDocument();
    expect(within(slider()!).getByRole('radiogroup')).toHaveAccessibleName(/ 만족도$/);
  });

  it('같은 그룹 맵으로 저장된다 — 타일로 고른 그룹과 슬라이더로 고른 그룹이 한 맵에 든다', () => {
    render(<Harness q={question('row-wise-scale')} />);
    fireEvent.click(screen.getByText('활용함', { selector: 'span' }));
    press(track(), tickX(7));
    expect(valueOf()).toEqual({ rad1: 'u1', rad2: 'sat7' });
  });

  it('슬라이더로 그려지는 행이 없으면 고른 표시 방식 그대로다', () => {
    // 「행별 척도」 — 못 그린 그룹은 그 그룹 열의 원본 조각
    const scale = render(<Harness q={fallbackQuestion('row-wise-scale')} />);
    expect(screen.getByTestId('mobile-row-wise-original-sheet')).toBeInTheDocument();
    expect(slider()).not.toBeInTheDocument();
    expect(within(rowBlock('r1')).getAllByRole('grid')).toHaveLength(1);
    scale.unmount();

    // 「행 단위 카드」 — 행 단위 배치로 바뀌지 않는다
    render(<Harness q={fallbackQuestion('row-cards')} />);
    expect(screen.queryByTestId('mobile-row-wise-original-sheet')).not.toBeInTheDocument();
    expect(screen.getByTestId('row-card-r1')).toBeInTheDocument();
  });

  it('슬라이더 설정이 없는 표는 좁은 폭에서도 고른 표시 방식 그대로다', () => {
    render(<Harness q={question('row-cards', {})} />);
    expect(screen.queryByTestId('mobile-row-wise-original-sheet')).not.toBeInTheDocument();
    expect(screen.getByTestId('row-card-r1')).toBeInTheDocument();
    expect(slider()).not.toBeInTheDocument();
  });
});
