import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expandRepeatRows } from '@/lib/question/row-repeat';
import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/mobile-table-display';
import type {
  ChoiceGroup,
  Question,
  RowRepeatConfig,
  StagedRowsConfig,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 표 문항 — 넓은 폭에서 보기 모양이 「척도 슬라이더」인 보기 묶음(CONTEXT.md 「척도 슬라이더」).
 *
 * 슬라이더로 그려지는 행이 있으면 표가 아니라 행 단위 배치로 그리고 행마다 슬라이더가 선다. 값은 슬라이더를
 * 끈 같은 문항과 같은 응답 키·같은 값이다. 좁은 폭은 `-scale-slider-mobile` 파일이 본다.
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
      { id: `${id}-use1`, type: 'choice_opt', content: '①', choiceLabel: '활용함', choiceGroupId: 'g-use' },
      { id: `${id}-use2`, type: 'choice_opt', content: '②', choiceLabel: '활용 안함', choiceGroupId: 'g-use' },
      ...CIRC.map((content, n) =>
        edit({
          id: `${id}-sat${n}`,
          type: 'choice_opt',
          content,
          choiceLabel: NAMES[n]!,
          choiceGroupId: 'g-sat',
        }),
      ),
      {
        id: `${id}-na`,
        type: 'choice_opt',
        content: '⑨',
        choiceLabel: '이용한 적 없음',
        choiceGroupId: 'g-sat',
        excludeFromMean: true,
      },
      { id: `${id}-memo`, type: 'input', content: '' },
    ],
  };
}

const rows: TableRow[] = [
  scaleRow('r1', '1) 주차/접근성'),
  scaleRow('r2', '2) 도보통행 편의성'),
  scaleRow('r3', '3) 화장실/휴게시설'),
];

const USE: ChoiceGroup = { id: 'g-use', groupKey: 'rad1', type: 'radio', label: '활용 여부' };
const SAT: ChoiceGroup = { id: 'g-sat', groupKey: 'rad2', type: 'radio', label: '만족도' };
const SLIDER: Partial<ChoiceGroup> = { scaleSlider: 'positive-right' };

interface HarnessProps {
  satGroup?: Partial<ChoiceGroup>;
  useGroup?: Partial<ChoiceGroup>;
  tableRows?: TableRow[];
  tableColumns?: TableColumn[];
  onChangeSpy?: (value: Record<string, unknown>) => void;
  extra?: Partial<React.ComponentProps<typeof InteractiveTableResponse>>;
}

function Harness({
  satGroup = SLIDER,
  useGroup = {},
  tableRows = rows,
  tableColumns = columns,
  onChangeSpy,
  extra,
}: HarnessProps) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={tableColumns}
        rows={tableRows}
        choiceGroups={[
          { ...USE, ...useGroup },
          { ...SAT, ...satGroup },
        ]}
        mobileDrilldownOmitLeadingColumns={1}
        value={value}
        onChange={(next) => {
          onChangeSpy?.(next);
          setValue(next);
        }}
        {...extra}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);
const rowBlock = (rowId: string) =>
  document.querySelector<HTMLElement>(`[data-row-question-id="${rowId}"]`)!;
const sheet = () => screen.queryByTestId('mobile-row-wise-original-sheet');
/** 원본 표 격자 — 행 단위 배치 안의 원본 표 조각(한 줄짜리 격자)은 세지 않는다 */
const tableGrids = () =>
  screen.queryAllByRole('grid').filter((grid) => !sheet()?.contains(grid));

/** 그 행의 트랙 — 범위를 왼쪽 100px · 폭 500px 로 준다 */
function trackOf(rowId: string): HTMLElement {
  const track = within(rowBlock(rowId)).getByTestId('scale-slider-track');
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

describe('표 문항 — 넓은 폭의 척도 슬라이더', () => {
  it('표가 아니라 행 단위 배치로 그리고 행마다 슬라이더가 선다', () => {
    render(<Harness />);
    expect(sheet()).toBeInTheDocument();
    expect(tableGrids()).toHaveLength(0);
    for (const row of rows) {
      const block = rowBlock(row.id);
      expect(within(block).getByText(row.label)).toBeInTheDocument();
      const slider = within(block).getByTestId('scale-slider-g-sat');
      // 눈금 5개 + 척도 밖 체크 하나가 라디오 묶음 하나다
      expect(within(slider).getAllByRole('radio')).toHaveLength(6);
      expect(within(slider).getByTestId('scale-slider-off-scale')).toHaveTextContent(
        '이용한 적 없음',
      );
    }
  });

  it('모바일 표시 방식을 무엇으로 골랐어도 넓은 폭은 행 단위 배치다', () => {
    for (const mode of MOBILE_TABLE_DISPLAY_MODES) {
      const { unmount } = render(<Harness extra={{ mobileTableDisplayMode: mode }} />);
      expect(sheet()).toBeInTheDocument();
      expect(screen.getAllByTestId('scale-slider-g-sat')).toHaveLength(rows.length);
      unmount();
    }
  });

  it.each([
    ['세로 타일(기본)', {}],
    ['척도 막대', { mobileScaleBar: true }],
    ['원본 한 줄', { mobileOriginalLine: true }],
  ] as const)('슬라이더가 아닌 보기 묶음(%s)은 원본 한 줄로 그려진다', (_name, useGroup) => {
    render(<Harness useGroup={useGroup} />);
    const block = rowBlock('r1');
    // 세로 타일 묶음도 척도 막대도 넓은 화면에 내지 않는다
    expect(within(block).queryByRole('group', { name: '활용 여부' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g-use')).not.toBeInTheDocument();
    // 원본 표 조각 — 열 머리와 그 묶음의 라디오 둘
    expect(within(block).getByText('활용함')).toBeInTheDocument();
    const slider = within(block).getByTestId('scale-slider-g-sat');
    const pieceRadios = within(block)
      .getAllByRole('radio')
      .filter((radio) => !slider.contains(radio));
    expect(pieceRadios).toHaveLength(2);
    fireEvent.click(pieceRadios[1]!);
    expect(valueOf()).toEqual({ __choiceGroups: { rad1: 'r1-use2' } });
  });

  it('묶음 밖 응답 칸은 같은 행 안의 원본 표 조각으로 남는다', () => {
    render(<Harness />);
    const block = rowBlock('r2');
    const memo = within(block).getByRole('textbox');
    fireEvent.change(memo, { target: { value: '회의실 예약이 어렵습니다' } });
    expect(valueOf()).toEqual({ 'r2-memo': '회의실 예약이 어렵습니다' });
  });

  it('행에 응답 묶음이 여럿이면 슬라이더 머리에 묶음 이름을 두고, 하나뿐이면 행 제목이 이름이다', () => {
    const { unmount } = render(<Harness />);
    expect(within(rowBlock('r1')).getByRole('radiogroup', { name: '만족도' })).toBeInTheDocument();
    unmount();

    const onlyScale = rows.map((row) => ({ ...row, cells: [row.cells[0]!, ...row.cells.slice(3, 9)] }));
    render(
      <Harness
        tableRows={onlyScale}
        tableColumns={[columns[0]!, ...columns.slice(3, 9)]}
      />,
    );
    const block = rowBlock('r1');
    expect(within(block).getByRole('radiogroup', { name: '1) 주차/접근성' })).toBeInTheDocument();
    expect(within(block).queryByText('만족도')).not.toBeInTheDocument();
  });

  it('한 행에 슬라이더 묶음이 둘이면 묶음 이름과 함께 위아래로 선다', () => {
    render(<Harness useGroup={SLIDER} />);
    const block = rowBlock('r1');
    const groups = within(block).getAllByRole('radiogroup');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['활용 여부', '만족도']);
  });
});

describe('표 문항 — 슬라이더로 답한 값', () => {
  it('슬라이더를 끈 같은 문항과 같은 응답 키·같은 값으로 쓰인다', () => {
    const slider = render(<Harness />);
    press(trackOf('r1'), TICK_X[3]!);
    const sliderValue = valueOf();
    slider.unmount();

    // 같은 문항, 슬라이더만 끔 — 넓은 폭의 원본 표에서 같은 칸을 고른다
    render(<Harness satGroup={{}} />);
    expect(sheet()).not.toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-cell-id="r1-sat3"] input[type="radio"]')!);
    expect(sliderValue).toEqual(valueOf());
    expect(sliderValue).toEqual({ __choiceGroups: { rad2: 'r1-sat3' } });
  });

  it('고른 자리를 다시 누르면 그 키가 비워진다 — 끈 문항에서 다시 누른 것과 같다', () => {
    const slider = render(<Harness />);
    const track = trackOf('r1');
    press(track, TICK_X[1]!);
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'r1-sat1' } });
    press(track, TICK_X[1]!);
    const cleared = valueOf();
    expect(cleared.__choiceGroups).not.toHaveProperty('rad2');
    slider.unmount();

    render(<Harness satGroup={{}} />);
    const radio = document.querySelector('[data-cell-id="r1-sat1"] input[type="radio"]')!;
    fireEvent.click(radio);
    fireEvent.click(radio);
    expect(cleared).toEqual(valueOf());
  });

  it('행마다 따로 쓰인다 — 같은 묶음 키 아래 행의 칸 id 가 값이다', () => {
    render(<Harness />);
    press(trackOf('r2'), TICK_X[4]!);
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'r2-sat4' } });
    // 점 타일을 눌러도 같은 쓰기다
    fireEvent.click(within(rowBlock('r2')).getByText('불만족', { selector: 'label *' }));
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'r2-sat1' } });
  });

  it('척도 밖 체크를 고르면 그 칸이 값이고, 눈금을 고르면 눈금으로 바뀐다', () => {
    render(<Harness />);
    const block = rowBlock('r3');
    fireEvent.click(within(block).getByRole('radio', { name: '이용한 적 없음' }));
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'r3-na' } });
    expect(within(block).queryByTestId('scale-slider-thumb')).not.toBeInTheDocument();
    press(trackOf('r3'), TICK_X[0]!);
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'r3-sat0' } });
  });

  it('끄는 동안에는 응답 상태가 바뀌지 않고 놓았을 때 한 번만 바뀐다', () => {
    const onChangeSpy = vi.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);
    const track = trackOf('r1');
    down(track, TICK_X[0]!);
    for (const x of [200, 260, 330, 410, 480, 550]) move(track, x);
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(valueOf()).toEqual({});
    up(track, TICK_X[4]!);
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'r1-sat4' } });
  });

  it('끌다가 고른 눈금에 다시 놓으면 응답 상태가 그대로다', () => {
    const onChangeSpy = vi.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);
    const track = trackOf('r1');
    press(track, TICK_X[2]!);
    onChangeSpy.mockClear();
    down(track, TICK_X[2]!);
    move(track, TICK_X[4]!);
    move(track, TICK_X[2]!);
    up(track, TICK_X[2]!);
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'r1-sat2' } });
  });
});

describe('표 문항 — 슬라이더로 그려지는 행이 없으면 지금과 같다', () => {
  it('설정이 없는 표는 넓은 폭에서 원본 표 그대로다', () => {
    render(<Harness satGroup={{}} />);
    expect(sheet()).not.toBeInTheDocument();
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.queryByTestId('scale-slider-g-sat')).not.toBeInTheDocument();
  });

  it('설정은 있는데 모든 행이 폴백이면 원본 표 그대로다', () => {
    // 상세 기재 보기가 낀 척도는 슬라이더로 그릴 수 없다
    const failing = rows.map((row) =>
      scaleRow(row.id, row.label, (cell) =>
        cell.id.endsWith('sat4') ? { ...cell, allowTextInput: true } : cell,
      ),
    );
    render(<Harness tableRows={failing} />);
    expect(sheet()).not.toBeInTheDocument();
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.queryByTestId('scale-slider-g-sat')).not.toBeInTheDocument();
  });

  it('일부 행만 폴백이면 행 단위 배치이고, 그 행은 원본 표 조각으로 그려진다', () => {
    const mixed = [
      rows[0]!,
      scaleRow('r2', '2) 기타', (cell) =>
        cell.id.endsWith('sat4') ? { ...cell, allowTextInput: true } : cell,
      ),
    ];
    render(<Harness tableRows={mixed} />);
    expect(sheet()).toBeInTheDocument();
    expect(within(rowBlock('r1')).getByTestId('scale-slider-g-sat')).toBeInTheDocument();
    const fallback = rowBlock('r2');
    expect(within(fallback).queryByTestId('scale-slider-g-sat')).not.toBeInTheDocument();
    // 활용 여부 2 + 만족도 5 + 이용한 적 없음 1
    expect(within(fallback).getAllByRole('radio')).toHaveLength(8);
    fireEvent.click(fallback.querySelector('[data-cell-id="r2-sat2"] input[type="radio"]')!);
    expect(valueOf()).toEqual({ __choiceGroups: { rad2: 'r2-sat2' } });
  });
});

describe('표 문항 — 넓은 폭의 행 단위 배치가 「행별 척도」와 같이 동작한다', () => {
  it('행 표시 조건으로 숨은 행은 그려지지 않고, 조건이 맞으면 슬라이더와 함께 나타난다', () => {
    const SOURCE_Q = 'q-source';
    const sourceQuestion = {
      id: SOURCE_Q,
      type: 'radio',
      title: '이용 경험',
      order: 0,
      required: false,
      options: [
        { id: 'o1', label: '있음', value: '있음' },
        { id: 'o2', label: '없음', value: '없음' },
      ],
    } as unknown as Question;
    const conditional = rows.map((row) =>
      row.id === 'r2'
        ? {
            ...row,
            displayCondition: {
              logicType: 'AND' as const,
              conditions: [
                {
                  id: 'c1',
                  sourceQuestionId: SOURCE_Q,
                  conditionType: 'value-match' as const,
                  requiredValues: ['있음'],
                  logicType: 'AND' as const,
                },
              ],
            },
          }
        : row,
    );
    const hidden = render(
      <Harness
        tableRows={conditional}
        extra={{ allResponses: { [SOURCE_Q]: '없음' }, allQuestions: [sourceQuestion] }}
      />,
    );
    expect(sheet()).toBeInTheDocument();
    expect(rowBlock('r2')).toBeNull();
    expect(screen.getAllByTestId('scale-slider-g-sat')).toHaveLength(2);
    hidden.unmount();

    render(
      <Harness
        tableRows={conditional}
        extra={{ allResponses: { [SOURCE_Q]: '있음' }, allQuestions: [sourceQuestion] }}
      />,
    );
    expect(within(rowBlock('r2')).getByTestId('scale-slider-g-sat')).toBeInTheDocument();
  });

  it('행 차례로 열기 — 연 행만 그려지고 버튼은 배치 아래에 한 번 선다', () => {
    // 묶음에는 보기 칸이 든 행을 넣을 수 없다 — 척도 행 아래의 입력 줄 셋을 묶는다
    const memoRow = (id: string): TableRow => ({
      id,
      label: id,
      cells: columns.map((column, n) =>
        n === 0
          ? { id: `${id}-item`, type: 'text', content: `기타 ${id}` }
          : n === columns.length - 1
            ? { id: `${id}-memo`, type: 'input', content: '' }
            : { id: `${id}-${column.id}`, type: 'text', content: '' },
      ),
    });
    const config: StagedRowsConfig = {
      enabled: true,
      rowIds: ['m1', 'm2', 'm3'],
      initialVisibleCount: 1,
      addLabel: '항목 추가',
    };
    render(
      <Harness
        tableRows={[...rows, memoRow('m1'), memoRow('m2'), memoRow('m3')]}
        extra={{ stagedRowsConfig: config }}
      />,
    );
    expect(screen.getAllByTestId('scale-slider-g-sat')).toHaveLength(3);
    expect(rowBlock('m1')).not.toBeNull();
    expect(rowBlock('m2')).toBeNull();
    const buttons = screen.getAllByRole('button', { name: '항목 추가' });
    expect(buttons).toHaveLength(1);
    expect(
      sheet()!.compareDocumentPosition(buttons[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(buttons[0]!);
    expect(rowBlock('m2')).not.toBeNull();
    expect(rowBlock('m3')).toBeNull();
  });

  it('행 반복 — 반복 줄은 원본 표 조각으로 서고 벌을 더하면 한 줄이 늘어난다', () => {
    const config: RowRepeatConfig = {
      enabled: true,
      templateRowIds: ['rep'],
      maxRepeats: 3,
      addLabel: '의견 추가',
    };
    // 반복 줄 — 구분 글자 + 맨 끝 열의 입력칸(반복 블록에는 보기 칸을 넣을 수 없다)
    const seed: TableRow = {
      id: 'rep',
      label: '기타 의견',
      cells: columns.map((column, n) =>
        n === 0
          ? { id: 'rep-item', type: 'text', content: '기타 의견' }
          : n === columns.length - 1
            ? { id: 'rep-memo', type: 'input', content: '' }
            : { id: `rep-${column.id}`, type: 'text', content: '' },
      ),
    };
    let n = 0;
    const expanded = expandRepeatRows([...rows, seed], config, () => `gen${++n}`);
    const bundles = expanded.filter((row) => row.repeatIndex !== undefined);
    const second = bundles.find((row) => row.repeatIndex === 2)!;
    render(
      <Harness
        tableRows={expanded}
        extra={{ rowRepeatConfig: config }}
      />,
    );
    expect(screen.getAllByTestId('scale-slider-g-sat')).toHaveLength(3);
    expect(rowBlock('rep')).not.toBeNull();
    expect(rowBlock(second.id)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /의견 추가/ }));
    expect(rowBlock(second.id)).not.toBeNull();
    expect(within(rowBlock(second.id)).getByRole('textbox')).toBeInTheDocument();
  });
});
