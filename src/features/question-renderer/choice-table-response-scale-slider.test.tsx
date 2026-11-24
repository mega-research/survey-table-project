import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/mobile-table-display';
import type { ChoiceGroup, Question, TableCell, TableColumn, TableRow } from '@/types/survey';

import { ChoiceTableResponse } from './choice-table-response';

/**
 * 보기 소스 표(radio·checkbox 문항 + 내장 표) — 넓은 폭에서 보기 모양이 「척도 슬라이더」인 보기 그룹
 * (CONTEXT.md 「척도 슬라이더」).
 *
 * 슬라이더로 그려지는 행이 있으면 표가 아니라 행 단위 배치로 그리고 행마다 슬라이더가 선다. 값은 슬라이더를
 * 끈 같은 문항과 같은 응답 모양(그룹 맵)이다. 좁은 폭은 `-scale-slider-mobile`, 그룹 없는 표(문항 설정)는
 * `-scale-slider-ungrouped` 파일이 본다.
 *
 * jsdom 은 배치를 계산하지 않으므로 트랙 범위는 테스트가 준다(왼쪽 100px · 폭 500px). 눈금 5개면 칸 하나가
 * 100px 이고 눈금은 150 · 250 · 350 · 450 · 550 에 선다.
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

// 구분 | 활용 여부 2칸 | 만족도 5칸 | 이용한 적 없음(척도 밖) | 개선 의견
const columns: TableColumn[] = [
  { id: 'item', label: '구분', width: 190 },
  { id: 'use1', label: '활용함', width: 70 },
  { id: 'use2', label: '활용 안함', width: 70 },
  ...NAMES.map((label, n) => ({ id: `s${n}`, label, width: 80 })),
  { id: 'na', label: '이용한 적 없음', width: 90 },
  { id: 'memo', label: '개선 의견', width: 200 },
];

function scaleRow(id: string, title: string, edit: (cell: TableCell) => TableCell = (c) => c): TableRow {
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
      ...CIRC.map((content, n) =>
        edit({
          id: `${id}-sat${n}`,
          type: 'choice_opt',
          content,
          choiceLabel: NAMES[n]!,
          choiceGroupId: `g-sat-${id}`,
        }),
      ),
      {
        id: `${id}-na`,
        type: 'choice_opt',
        content: '⑨',
        choiceLabel: '이용한 적 없음',
        choiceGroupId: `g-sat-${id}`,
        excludeFromMean: true,
      },
      { id: `${id}-memo`, type: 'input', content: '', placeholder: '개선 의견' },
    ],
  };
}

const rows: TableRow[] = [scaleRow('r1', '1) 주차/접근성'), scaleRow('r2', '2) 도보통행 편의성')];

// 그룹 하나가 변수 하나다 — 행마다 「활용 여부」·「만족도」 그룹이 따로 있다(그룹 키 use_<행>·sat_<행>)
const SLIDER: Partial<ChoiceGroup> = { scaleSlider: 'positive-right' };

interface QuestionOptions {
  satGroup?: Partial<ChoiceGroup>;
  tableRows?: TableRow[];
  extra?: Partial<Question>;
}

function question({ satGroup = SLIDER, tableRows = rows, extra = {} }: QuestionOptions = {}): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '시설 만족도',
    required: false,
    order: 0,
    mobileDrilldownOmitLeadingColumns: 1,
    choiceGroups: tableRows.flatMap((row): ChoiceGroup[] => [
      { id: `g-use-${row.id}`, groupKey: `use_${row.id}`, type: 'radio', label: '활용 여부' },
      {
        id: `g-sat-${row.id}`,
        groupKey: `sat_${row.id}`,
        type: 'radio',
        label: '만족도',
        ...satGroup,
      },
    ]),
    tableColumns: columns,
    tableRowsData: tableRows,
    ...extra,
  } as unknown as Question;
}

function Harness({
  q,
  onChangeSpy,
  unfilled,
}: {
  q: Question;
  onChangeSpy?: (value: unknown) => void;
  unfilled?: Set<string>;
}) {
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
        unfilledGroupCellIds={unfilled}
      />
      <output data-testid="value">{JSON.stringify(value ?? null)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);
const rowBlock = (rowId: string) =>
  document.querySelector<HTMLElement>(`[data-row-question-id="${rowId}"]`)!;
const sheet = () => screen.queryByTestId('mobile-row-wise-original-sheet');
/** 원본 표 격자 — 행 단위 배치 안의 원본 표 조각(한 줄짜리 격자)은 세지 않는다 */
const tableGrids = () => screen.queryAllByRole('grid').filter((grid) => !sheet()?.contains(grid));

const sliderOf = (rowId: string) =>
  within(rowBlock(rowId)).queryByTestId(`scale-slider-g-sat-${rowId}`);
const sliderCount = () => document.querySelectorAll('[data-testid^="scale-slider-g-sat-"]').length;

/** 그 행의 만족도 트랙 — 범위를 왼쪽 100px · 폭 500px 로 준다 */
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
/** 슬라이더를 끈 같은 문항의 원본 표에서 그 그룹의 n번째 라디오 */
const tableRadio = (groupKey: string, index: number) =>
  document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="q1-${groupKey}"]`)[index]!;

describe('보기 소스 표 — 넓은 폭의 척도 슬라이더', () => {
  it('표가 아니라 행 단위 배치로 그리고 행마다 슬라이더가 선다', () => {
    render(<Harness q={question()} />);
    expect(sheet()).toBeInTheDocument();
    expect(tableGrids()).toHaveLength(0);
    expect(sliderCount()).toBe(2);
    for (const rowId of ['r1', 'r2']) {
      const slider = sliderOf(rowId)!;
      expect(slider.querySelectorAll('[data-tile="point"]')).toHaveLength(5);
      expect(within(slider).getByTestId('scale-slider-off-scale')).toHaveTextContent(
        '이용한 적 없음',
      );
      // 넓은 폭 — 척도 밖 체크는 트랙 오른쪽 같은 줄
      expect(within(slider).getByTestId('scale-slider-off-scale')).toHaveAttribute(
        'data-placement',
        'beside',
      );
    }
    expect(within(rowBlock('r1')).getByText('1) 주차/접근성')).toBeInTheDocument();
  });

  it('모바일 표시 방식을 무엇으로 골랐어도 넓은 폭은 행 단위 배치다', () => {
    for (const mode of MOBILE_TABLE_DISPLAY_MODES) {
      const { unmount } = render(
        <Harness q={question({ extra: { mobileTableDisplayMode: mode } })} />,
      );
      expect(sheet(), mode).toBeInTheDocument();
      expect(sliderCount(), mode).toBe(2);
      unmount();
    }
  });

  it('슬라이더가 아닌 보기 그룹과 그룹 밖 입력칸은 같은 행 안의 원본 표 조각으로 남는다', () => {
    render(<Harness q={question()} />);
    const block = rowBlock('r1');
    const pieces = within(block).getAllByRole('grid');
    // 활용 여부 2칸이 조각 하나, 슬라이더 뒤의 입력칸이 조각 하나
    expect(pieces).toHaveLength(2);
    expect(within(pieces[0]!).getAllByRole('radio')).toHaveLength(2);
    expect(within(pieces[1]!).getByRole('textbox')).toBeInTheDocument();
    // 세로 타일로 그리지 않는다 — 타일 묶음(role group, 이름 = 그룹 이름)이 없다
    expect(within(block).queryByRole('group', { name: '활용 여부' })).not.toBeInTheDocument();
  });

  it('한 행에 응답 묶음이 여럿이면 슬라이더 머리에 그룹 이름을 둔다', () => {
    render(<Harness q={question()} />);
    // 낭독 이름은 「행 제목, 그룹 이름」이다(행 제목 요소와 머리 줄을 함께 가리킨다) — 머리 줄에는 그룹 이름만 보인다
    expect(within(sliderOf('r1')!).getByRole('radiogroup')).toHaveAccessibleName(/ 만족도$/);
    expect(within(sliderOf('r1')!).getByText('만족도')).toBeInTheDocument();
  });

  it('행에 응답 묶음이 하나뿐이면 머리를 비우고 행 제목이 낭독용 이름이다', () => {
    const only: TableRow = {
      id: 'r1',
      label: '1) 주차/접근성',
      cells: scaleRow('r1', '1) 주차/접근성').cells.filter(
        (cell) => cell.type === 'text' || cell.choiceGroupId === 'g-sat-r1',
      ),
    };
    const q = question({ tableRows: [only] });
    q.tableColumns = columns.filter((column) => !['use1', 'use2', 'memo'].includes(column.id));
    render(<Harness q={q} />);
    expect(
      within(sliderOf('r1')!).getByRole('radiogroup', { name: '1) 주차/접근성' }),
    ).toBeInTheDocument();
    expect(within(sliderOf('r1')!).queryByText('만족도')).not.toBeInTheDocument();
  });
});

describe('보기 소스 표 슬라이더 — 값', () => {
  it('슬라이더로 답한 값이 끈 같은 문항에서 라디오로 답한 값과 같은 그룹 맵이다', () => {
    const on = render(<Harness q={question()} />);
    press(trackOf('r1'), TICK_X[3]!);
    const sliderValue = valueOf();
    on.unmount();

    render(<Harness q={question({ satGroup: {} })} />);
    expect(tableGrids()).toHaveLength(1);
    fireEvent.click(tableRadio('sat_r1', 3));
    expect(sliderValue).toEqual({ sat_r1: 'r1-sat3' });
    expect(valueOf()).toEqual(sliderValue);
  });

  it('고른 자리를 다시 누르면 그 키가 비워진다 — 끈 문항에서 다시 누른 것과 같다', () => {
    const on = render(<Harness q={question()} />);
    press(trackOf('r1'), TICK_X[1]!);
    press(trackOf('r2'), TICK_X[4]!);
    press(trackOf('r1'), TICK_X[1]!);
    const sliderValue = valueOf();
    on.unmount();

    render(<Harness q={question({ satGroup: {} })} />);
    fireEvent.click(tableRadio('sat_r1', 1));
    fireEvent.click(tableRadio('sat_r2', 4));
    fireEvent.click(tableRadio('sat_r1', 1));
    expect(sliderValue).toEqual({ sat_r2: 'r2-sat4' });
    expect(valueOf()).toEqual(sliderValue);
  });

  it('척도 밖 체크를 고르면 그 칸이 값이고 손잡이가 사라진다', () => {
    render(<Harness q={question()} />);
    press(trackOf('r1'), TICK_X[2]!);
    expect(within(sliderOf('r1')!).getByTestId('scale-slider-thumb')).toBeInTheDocument();
    fireEvent.click(within(sliderOf('r1')!).getByRole('radio', { name: '이용한 적 없음' }));
    expect(valueOf()).toEqual({ sat_r1: 'r1-na' });
    expect(within(sliderOf('r1')!).queryByTestId('scale-slider-thumb')).not.toBeInTheDocument();
  });

  it('끄는 동안에는 응답이 바뀌지 않고 놓았을 때 한 번만 바뀐다', () => {
    const onChangeSpy = vi.fn();
    render(<Harness q={question()} onChangeSpy={onChangeSpy} />);
    const track = trackOf('r1');
    down(track, TICK_X[0]!);
    move(track, TICK_X[2]!);
    move(track, TICK_X[4]!);
    expect(onChangeSpy).not.toHaveBeenCalled();
    up(track, TICK_X[4]!);
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(valueOf()).toEqual({ sat_r1: 'r1-sat4' });
  });

  it('슬라이더가 아닌 그룹의 조각에서 고른 값도 같은 그룹 맵에 쓰인다', () => {
    render(<Harness q={question()} />);
    const [usePiece] = within(rowBlock('r2')).getAllByRole('grid');
    fireEvent.click(within(usePiece!).getAllByRole('radio')[1]!);
    press(trackOf('r2'), TICK_X[0]!);
    expect(valueOf()).toEqual({ use_r2: 'r2-use2', sat_r2: 'r2-sat0' });
  });
});

describe('보기 소스 표 슬라이더 — 상태', () => {
  it('미충족 필수 그룹의 슬라이더만 강조되고 그 행 제목이 붉어진다', () => {
    const unfilled = new Set(rows[1]!.cells.filter((c) => c.choiceGroupId === 'g-sat-r2').map((c) => c.id));
    render(<Harness q={question()} unfilled={unfilled} />);
    expect(within(sliderOf('r2')!).getByTestId('scale-slider-track')).toHaveAttribute(
      'data-invalid',
      'true',
    );
    expect(within(sliderOf('r2')!).getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
    expect(within(sliderOf('r1')!).getByTestId('scale-slider-track')).not.toHaveAttribute(
      'data-invalid',
    );
    expect(within(rowBlock('r2')).getByText('2) 도보통행 편의성')).toHaveClass('text-red-700');
    expect(within(rowBlock('r1')).getByText('1) 주차/접근성')).not.toHaveClass('text-red-700');
  });

  it('잠긴 문항(fieldset disabled) 안에서는 눌러도 끌어도 값이 쓰이지 않는다', () => {
    const onChangeSpy = vi.fn();
    render(
      <fieldset disabled>
        <Harness q={question()} onChangeSpy={onChangeSpy} />
      </fieldset>,
    );
    const track = trackOf('r1');
    press(track, TICK_X[3]!);
    down(track, TICK_X[0]!);
    move(track, TICK_X[4]!);
    up(track, TICK_X[4]!);
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(valueOf()).toBeNull();
  });
});

describe('보기 소스 표 슬라이더 — 켜지지 않는 표', () => {
  it('설정이 없는 표는 넓은 폭에서 원본 표 그대로다', () => {
    render(<Harness q={question({ satGroup: {} })} />);
    expect(sheet()).not.toBeInTheDocument();
    expect(tableGrids()).toHaveLength(1);
    expect(sliderCount()).toBe(0);
    expect(screen.getAllByRole('radio')).toHaveLength(16);
  });

  it('설정은 있는데 모든 행이 폴백이면 원본 표 그대로다', () => {
    const withDetail = (id: string, title: string) =>
      scaleRow(id, title, (cell) =>
        cell.id.endsWith('sat4') ? { ...cell, allowTextInput: true } : cell,
      );
    render(
      <Harness
        q={question({ tableRows: [withDetail('r1', '1) 주차'), withDetail('r2', '2) 도보')] })}
      />,
    );
    expect(sheet()).not.toBeInTheDocument();
    expect(tableGrids()).toHaveLength(1);
    expect(sliderCount()).toBe(0);
  });

  it('일부 행만 폴백이면 행 단위 배치이고, 그 행은 원본 표 조각으로 그려진다', () => {
    const withDetail = scaleRow('r2', '2) 도보통행 편의성', (cell) =>
      cell.id.endsWith('sat4') ? { ...cell, allowTextInput: true } : cell,
    );
    render(<Harness q={question({ tableRows: [rows[0]!, withDetail] })} />);
    expect(sheet()).toBeInTheDocument();
    expect(sliderOf('r1')).toBeInTheDocument();
    expect(sliderOf('r2')).not.toBeInTheDocument();
    // 그 행은 행 전체가 원본 조각 하나다 — 활용 여부 2 + 만족도 5 + 척도 밖 1
    expect(within(rowBlock('r2')).getAllByRole('grid')).toHaveLength(1);
    expect(within(rowBlock('r2')).getAllByRole('radio')).toHaveLength(8);
  });

  it('그룹이 있는 표는 문항 설정이 켜져 있어도 그룹 설정만 따른다', () => {
    // 그룹에 슬라이더 설정이 없다 — 문항 설정은 읽히지 않아 원본 표 그대로다
    const off = render(
      <Harness q={question({ satGroup: {}, extra: { scaleSlider: 'positive-right' } })} />,
    );
    expect(sheet()).not.toBeInTheDocument();
    expect(tableGrids()).toHaveLength(1);
    off.unmount();

    // 그룹의 방향(왼쪽이 긍정)이 문항의 방향(오른쪽이 긍정)을 이긴다
    render(
      <Harness
        q={question({
          satGroup: { scaleSlider: 'positive-left' },
          extra: { scaleSlider: 'positive-right' },
        })}
      />,
    );
    const firstTile = sliderOf('r1')!.querySelector('[data-tile="point"]');
    expect(firstTile).toHaveAttribute('data-side', 'positive');
  });

  it('체크박스 문항 안의 라디오 그룹은 그룹 설정으로 슬라이더가 되고, 체크박스 그룹은 값이 있어도 되지 않는다', () => {
    const radioInCheckbox = render(<Harness q={question({ extra: { type: 'checkbox' } })} />);
    expect(sliderCount()).toBe(2);
    press(trackOf('r1'), TICK_X[2]!);
    expect(valueOf()).toEqual({ sat_r1: 'r1-sat2' });
    radioInCheckbox.unmount();

    render(
      <Harness
        q={question({
          satGroup: { type: 'checkbox', scaleSlider: 'positive-right' },
          extra: { type: 'checkbox' },
        })}
      />,
    );
    expect(sheet()).not.toBeInTheDocument();
    expect(sliderCount()).toBe(0);
  });
});
