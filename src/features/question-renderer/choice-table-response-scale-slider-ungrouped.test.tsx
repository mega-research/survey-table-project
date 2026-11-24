import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/mobile-table-display';
import type { Question, TableCell, TableColumn, TableRow } from '@/types/survey';

import { ChoiceTableResponse } from './choice-table-response';

/**
 * 그룹 없는 보기 소스 표(radio 문항 + 내장 표, 보기 그룹 없음) — 그룹별 설정이 없어 **문항 설정**
 * (`Question.scaleSlider`)이 슬라이더를 켠다(CONTEXT.md 「척도 슬라이더」).
 *
 * 켜면 그 표의 보기 칸이 이어진 묶음마다 슬라이더가 된다(「행별 척도」에서 막대가 되는 것과 같은 단위).
 * 값은 끈 같은 문항과 같은 모양 — 고른 보기 칸 id 하나(문자열)다. 문항 전체가 단일 선택이라, 행이 여럿이어도
 * 답은 하나다.
 *
 * jsdom 은 배치를 계산하지 않으므로 트랙 범위는 테스트가 준다(왼쪽 100px · 폭 500px, 눈금 5개).
 */

const view = vi.hoisted(() => ({ mobile: false }));
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
  view.mobile = false;
});

const NAMES = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
const CIRC = ['①', '②', '③', '④', '⑤'];

// 구분 | 만족도 5칸 | 이용한 적 없음(척도 밖)
const columns: TableColumn[] = [
  { id: 'item', label: '구분', width: 190 },
  ...NAMES.map((label, n) => ({ id: `s${n}`, label, width: 80 })),
  { id: 'na', label: '이용한 적 없음', width: 90 },
];

function scaleRow(id: string, title: string, edit: (cell: TableCell) => TableCell = (c) => c): TableRow {
  return {
    id,
    label: title,
    cells: [
      { id: `${id}-item`, type: 'text', content: title },
      ...CIRC.map((content, n) =>
        edit({ id: `${id}-sat${n}`, type: 'choice_opt', content, choiceLabel: NAMES[n]! }),
      ),
      {
        id: `${id}-na`,
        type: 'choice_opt',
        content: '⑨',
        choiceLabel: '이용한 적 없음',
        excludeFromMean: true,
      },
    ],
  };
}

const ONE_ROW: TableRow[] = [scaleRow('r1', '전반적 만족도')];

function question(extra: Partial<Question> = {}, tableRows: TableRow[] = ONE_ROW): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '전반적으로 얼마나 만족하십니까?',
    required: false,
    order: 0,
    mobileDrilldownOmitLeadingColumns: 1,
    tableColumns: columns,
    tableRowsData: tableRows,
    ...extra,
  } as unknown as Question;
}
const ON: Partial<Question> = { scaleSlider: 'positive-right' };

function Harness({ q, onChangeSpy }: { q: Question; onChangeSpy?: (value: unknown) => void }) {
  const [value, setValue] = useState<unknown>(undefined);
  return (
    <>
      <ChoiceTableResponse
        question={q}
        value={value}
        onChange={(next) => {
          onChangeSpy?.(next);
          setValue(next);
        }}
      />
      <output data-testid="value">{JSON.stringify(value ?? null)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);
const rowBlock = (rowId: string) =>
  document.querySelector<HTMLElement>(`[data-row-question-id="${rowId}"]`)!;
const sheet = () => screen.queryByTestId('mobile-row-wise-original-sheet');
const tableGrids = () => screen.queryAllByRole('grid').filter((grid) => !sheet()?.contains(grid));
/** 그 행의 슬라이더 — 그룹 없는 묶음의 키는 첫 칸 id 로 만든다 */
const sliderOf = (rowId: string) => screen.queryByTestId(`scale-slider-run:${rowId}-sat0`);
const sliderCount = () => document.querySelectorAll('[data-testid^="scale-slider-run:"]').length;
const scaleBarCount = () =>
  document.querySelectorAll('[data-testid^="choice-group-scale-bar-"]').length;

function trackOf(rowId: string): HTMLElement {
  const track = within(sliderOf(rowId)!).getByTestId('scale-slider-track');
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
const down = (track: HTMLElement, x: number) =>
  fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX: x });
const move = (track: HTMLElement, x: number) =>
  fireEvent.pointerMove(track, { pointerId: 1, button: 0, clientX: x });
const up = (track: HTMLElement, x: number) =>
  fireEvent.pointerUp(track, { pointerId: 1, button: 0, clientX: x });
const press = (track: HTMLElement, x: number) => {
  down(track, x);
  up(track, x);
};

describe('그룹 없는 보기 소스 표 — 문항 설정을 켠 넓은 폭', () => {
  it('표가 아니라 행 단위 배치로 그리고 그 행의 보기 칸이 슬라이더가 된다', () => {
    render(<Harness q={question(ON)} />);
    expect(sheet()).toBeInTheDocument();
    expect(tableGrids()).toHaveLength(0);
    const slider = sliderOf('r1')!;
    expect(within(rowBlock('r1')).getByTestId('scale-slider-run:r1-sat0')).toBe(slider);
    expect(slider.querySelectorAll('[data-tile="point"]')).toHaveLength(5);
    expect(within(slider).getByTestId('scale-slider-off-scale')).toHaveTextContent('이용한 적 없음');
    // 행에 응답 묶음이 하나뿐이다 — 머리를 비우고 행 제목이 낭독용 이름이다
    expect(within(slider).getByRole('radiogroup', { name: '전반적 만족도' })).toBeInTheDocument();
  });

  it('긍정 방향은 문항 설정을 따른다', () => {
    render(<Harness q={question({ scaleSlider: 'positive-left' })} />);
    expect(sliderOf('r1')!.querySelector('[data-tile="point"]')).toHaveAttribute(
      'data-side',
      'positive',
    );
  });

  it('모바일 표시 방식을 무엇으로 골랐어도 넓은 폭은 행 단위 배치다', () => {
    for (const mode of MOBILE_TABLE_DISPLAY_MODES) {
      const { unmount } = render(<Harness q={question({ ...ON, mobileTableDisplayMode: mode })} />);
      expect(sheet(), mode).toBeInTheDocument();
      expect(sliderCount(), mode).toBe(1);
      unmount();
    }
  });
});

describe('그룹 없는 보기 소스 표 — 문항 설정을 켠 좁은 폭', () => {
  it('표시 방식이 「행 단위 그룹 카드」가 아니면 무엇이든 행 단위 배치이고 슬라이더가 선다', () => {
    view.mobile = true;
    for (const mode of MOBILE_TABLE_DISPLAY_MODES) {
      if (mode === 'row-group-cards') continue;
      const { unmount } = render(<Harness q={question({ ...ON, mobileTableDisplayMode: mode })} />);
      expect(sheet(), mode).toBeInTheDocument();
      expect(sliderCount(), mode).toBe(1);
      // 그룹 없는 묶음의 기본인 척도 막대로 그리지 않는다
      expect(scaleBarCount(), mode).toBe(0);
      unmount();
    }
  });

  it('좁은 폭 규칙으로 그린다 — 척도 밖 체크가 트랙 아래 줄이다', () => {
    view.mobile = true;
    render(<Harness q={question(ON)} />);
    expect(within(sliderOf('r1')!).getByTestId('scale-slider-off-scale')).toHaveAttribute(
      'data-placement',
      'below',
    );
  });

  it('「행 단위 그룹 카드」: 그 카드 안에서 슬라이더로 그린다', () => {
    view.mobile = true;
    render(<Harness q={question({ ...ON, mobileTableDisplayMode: 'row-group-cards' })} />);
    expect(sheet()).not.toBeInTheDocument();
    const card = screen.getByTestId('row-card-r1');
    const slider = within(card).getByTestId('scale-slider-run:r1-sat0');
    expect(within(slider).getAllByRole('radio')).toHaveLength(6);
    press(trackOf('r1'), TICK_X[3]!);
    expect(valueOf()).toBe('r1-sat3');
  });
});

describe('그룹 없는 보기 소스 표 슬라이더 — 값', () => {
  it('슬라이더로 답한 값이 끈 같은 문항에서 라디오로 답한 값과 같다 — 고른 보기 칸 id 하나', () => {
    const on = render(<Harness q={question(ON)} />);
    press(trackOf('r1'), TICK_X[3]!);
    const sliderValue = valueOf();
    on.unmount();

    render(<Harness q={question()} />);
    expect(tableGrids()).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: '만족' }));
    expect(sliderValue).toBe('r1-sat3');
    expect(valueOf()).toBe(sliderValue);
  });

  it('고른 자리를 다시 누르면 비워진다', () => {
    render(<Harness q={question(ON)} />);
    press(trackOf('r1'), TICK_X[1]!);
    expect(valueOf()).toBe('r1-sat1');
    press(trackOf('r1'), TICK_X[1]!);
    expect(valueOf()).toBeNull();
  });

  it('척도 밖 체크를 고르면 그 칸이 값이고, 눈금을 고르면 체크가 풀린다', () => {
    render(<Harness q={question(ON)} />);
    const offScale = within(sliderOf('r1')!).getByRole('radio', { name: '이용한 적 없음' });
    fireEvent.click(offScale);
    expect(valueOf()).toBe('r1-na');
    press(trackOf('r1'), TICK_X[0]!);
    expect(valueOf()).toBe('r1-sat0');
    expect(offScale).not.toBeChecked();
  });

  it('끄는 동안에는 응답이 바뀌지 않고 놓았을 때 한 번만 바뀐다', () => {
    const onChangeSpy = vi.fn();
    render(<Harness q={question(ON)} onChangeSpy={onChangeSpy} />);
    const track = trackOf('r1');
    down(track, TICK_X[0]!);
    move(track, TICK_X[2]!);
    move(track, TICK_X[4]!);
    expect(onChangeSpy).not.toHaveBeenCalled();
    up(track, TICK_X[4]!);
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onChangeSpy).toHaveBeenCalledWith('r1-sat4');
  });

  it('행이 여럿이면 행마다 슬라이더가 서지만 답은 문항에 하나다 — 끈 문항과 같다', () => {
    const two = [scaleRow('r1', '1) 주차'), scaleRow('r2', '2) 도보')];
    render(<Harness q={question(ON, two)} />);
    expect(sliderCount()).toBe(2);
    press(trackOf('r1'), TICK_X[1]!);
    press(trackOf('r2'), TICK_X[4]!);
    expect(valueOf()).toBe('r2-sat4');
    // 앞 행의 손잡이는 사라진다 — 그 행의 칸이 더는 고른 칸이 아니다
    expect(within(sliderOf('r1')!).queryByTestId('scale-slider-thumb')).not.toBeInTheDocument();
    expect(within(sliderOf('r2')!).getByTestId('scale-slider-thumb')).toBeInTheDocument();
  });

  it('잠긴 문항(fieldset disabled) 안에서는 눌러도 값이 쓰이지 않는다', () => {
    const onChangeSpy = vi.fn();
    render(
      <fieldset disabled>
        <Harness q={question(ON)} onChangeSpy={onChangeSpy} />
      </fieldset>,
    );
    press(trackOf('r1'), TICK_X[3]!);
    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});

describe('그룹 없는 보기 소스 표 — 문항 설정이 꺼진 표는 지금 화면 그대로다', () => {
  it('넓은 폭은 원본 표다 — 값 없음과 빌더가 끈 값(null) 둘 다', () => {
    for (const extra of [{}, { scaleSlider: null }] as Partial<Question>[]) {
      const { unmount } = render(<Harness q={question(extra)} />);
      expect(sheet()).not.toBeInTheDocument();
      expect(tableGrids()).toHaveLength(1);
      expect(sliderCount()).toBe(0);
      expect(screen.getAllByRole('radio')).toHaveLength(6);
      unmount();
    }
  });

  it('좁은 폭 「행별 척도」는 지금처럼 척도 막대다', () => {
    view.mobile = true;
    render(<Harness q={question({ mobileTableDisplayMode: 'row-wise-scale' })} />);
    expect(sliderCount()).toBe(0);
    expect(scaleBarCount()).toBe(1);
  });

  it('좁은 폭 「행 단위 그룹 카드」는 지금처럼 세로 타일이다', () => {
    view.mobile = true;
    render(<Harness q={question({ mobileTableDisplayMode: 'row-group-cards' })} />);
    expect(sliderCount()).toBe(0);
    expect(within(screen.getByTestId('row-card-r1')).getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByText('매우 만족', { selector: 'span' })).toBeInTheDocument();
  });
});

describe('그룹 없는 보기 소스 표 — 켜도 슬라이더가 되지 않는 표', () => {
  it('체크박스 문항은 값이 실려 있어도 원본 표 그대로다', () => {
    render(<Harness q={question({ ...ON, type: 'checkbox' })} />);
    expect(sheet()).not.toBeInTheDocument();
    expect(tableGrids()).toHaveLength(1);
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  });

  it('슬라이더로 그릴 수 없는 표(상세 기재 보기)는 원본 표 그대로다', () => {
    const withDetail = scaleRow('r1', '전반적 만족도', (cell) =>
      cell.id.endsWith('sat4') ? { ...cell, allowTextInput: true } : cell,
    );
    render(<Harness q={question(ON, [withDetail])} />);
    expect(sheet()).not.toBeInTheDocument();
    expect(tableGrids()).toHaveLength(1);
    expect(sliderCount()).toBe(0);
  });

  it('행이 곧 보기인 표(행마다 보기 칸 하나)는 원본 표 그대로다', () => {
    const optionRow = (id: string, title: string): TableRow => ({
      id,
      label: title,
      cells: [
        { id: `${id}-item`, type: 'text', content: title },
        { id: `${id}-pick`, type: 'choice_opt', content: '', choiceLabel: title },
      ],
    });
    render(
      <Harness
        q={question(
          {
            ...ON,
            tableColumns: [
              { id: 'item', label: '항목' },
              { id: 'pick', label: '선택' },
            ],
          },
          [optionRow('r1', '주차'), optionRow('r2', '도보'), optionRow('r3', '화장실')],
        )}
      />,
    );
    expect(sheet()).not.toBeInTheDocument();
    expect(tableGrids()).toHaveLength(1);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});
