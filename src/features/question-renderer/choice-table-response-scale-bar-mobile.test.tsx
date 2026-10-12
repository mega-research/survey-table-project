import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup, Question } from '@/types/survey';
import type { GroupedChoiceAnswer } from '@/utils/choice-group-helpers';

import { ChoiceTableResponse } from './choice-table-response';

/**
 * 보기 소스 표(radio/checkbox 문항 + 내장 표) — 「행 단위 그룹 카드」에서 보기 모양 「척도 막대」
 * (mobileScaleBar)를 고른 그룹만 척도 막대로 그린다. 표 문항과 같은 옵션·같은 막대이고, 선택 쓰기는
 * 이 문항의 보기 선택 채널(그룹 맵 `{그룹키: 셀 id}`)이다.
 */

const view = vi.hoisted(() => ({ mobile: true }));
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => view.mobile,
  useMediaQuery: () => view.mobile,
}));
afterEach(() => {
  view.mobile = true;
});

const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

function question(type: 'radio' | 'checkbox', satGroup: Partial<ChoiceGroup>): Question {
  return {
    id: 'q1',
    type,
    title: '지원제도',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'row-group-cards',
    choiceGroups: [
      { id: 'g-use', type, groupKey: 'rad1', label: '활용 여부' },
      { id: 'g-sat', type, groupKey: 'rad2', label: '만족도', ...satGroup },
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

function Harness({
  satGroup = { mobileScaleBar: true },
  initialValue = {},
  unfilledGroupCellIds,
}: {
  satGroup?: Partial<ChoiceGroup>;
  initialValue?: GroupedChoiceAnswer;
  unfilledGroupCellIds?: Set<string>;
}) {
  const [value, setValue] = useState<unknown>(initialValue);
  return (
    <>
      <ChoiceTableResponse
        question={question('radio', satGroup)}
        value={value}
        onChange={setValue}
        unfilledGroupCellIds={unfilledGroupCellIds}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);

describe('ChoiceTableResponse (mobile) — 척도 막대 그룹', () => {
  it('고른 그룹만 막대로 그린다 — 칸 글자 11개, 양끝·가운데 라벨. 다른 그룹은 세로 타일 그대로다', () => {
    render(<Harness />);
    const bar = screen.getByTestId('choice-group-scale-bar-g-sat');
    expect(within(bar).getAllByRole('radio')).toHaveLength(11);
    for (const text of CIRC) expect(within(bar).getByText(text)).toBeInTheDocument();
    for (const label of ['매우 불만족', '보통', '매우 만족']) {
      expect(within(bar).getByText(label)).toBeInTheDocument();
    }
    expect(within(bar).getByRole('radiogroup', { name: '만족도' })).toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-original-line-g-sat')).not.toBeInTheDocument();
    // 활용 여부는 종전 타일
    expect(screen.getByText('활용 안함', { selector: 'span' })).toBeInTheDocument();
  });

  it('칸을 누르면 그룹 맵에 원래 보기 칸 id 가 들어가고, 다른 칸을 누르면 바뀐다. 다른 그룹 답은 그대로다', () => {
    render(<Harness initialValue={{ rad1: 'u1' }} />);
    const bar = screen.getByTestId('choice-group-scale-bar-g-sat');
    expect(within(bar).queryByTestId('scale-bar-selection')).not.toBeInTheDocument();
    fireEvent.click(within(bar).getByText('⑦'));
    expect(valueOf()).toEqual({ rad1: 'u1', rad2: 'sat7' });
    fireEvent.click(within(bar).getByText('⑨'));
    expect(valueOf()).toEqual({ rad1: 'u1', rad2: 'sat9' });
    expect(within(bar).getByTestId('scale-bar-selection')).toHaveTextContent('⑨ · 만족');
  });

  it('칸의 접근성 이름은 칸 글자 + 구간 이름이다', () => {
    render(<Harness />);
    const bar = screen.getByTestId('choice-group-scale-bar-g-sat');
    expect(within(bar).getByRole('radio', { name: '⑧ 만족' })).toBeInTheDocument();
    expect(within(bar).getByRole('radio', { name: '⓪ 매우 불만족' })).toBeInTheDocument();
  });

  it('저장된 답이 있으면 그 칸이 선택된 채로 그려진다', () => {
    render(<Harness initialValue={{ rad2: 'sat8' }} />);
    const bar = screen.getByTestId('choice-group-scale-bar-g-sat');
    expect(within(bar).getByRole('radio', { name: '⑧ 만족' })).toBeChecked();
    expect(within(bar).getByRole('radio', { name: '⑦ 만족' })).not.toBeChecked();
    expect(within(bar).getByTestId('scale-bar-selection')).toHaveTextContent('⑧ · 만족');
  });

  it('원본 한 줄만 켠 그룹은 종전 원본 표 조각 그대로다', () => {
    render(<Harness satGroup={{ mobileOriginalLine: true }} />);
    expect(screen.getByTestId('choice-group-original-line-g-sat')).toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
  });

  it('checkbox 문항의 그룹은 복수 선택이라 원본 한 줄로 폴백한다', () => {
    render(
      <ChoiceTableResponse
        question={question('checkbox', { mobileScaleBar: true })}
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    const line = screen.getByTestId('choice-group-original-line-g-sat');
    expect(within(line).getAllByRole('checkbox')).toHaveLength(11);
  });

  it('데스크톱 폭에서는 막대가 나오지 않는다', () => {
    view.mobile = false;
    render(<Harness />);
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio').length).toBeGreaterThanOrEqual(13);
  });
});

describe('ChoiceTableResponse (mobile) — 척도 막대 상태(필수 오류 · 방향키)', () => {
  it('「다음」 뒤 미충족 필수 그룹이면 막대 묶음이 오류 상태다', () => {
    const satIds = new Set(CIRC.map((_, n) => `sat${n}`));
    const { rerender } = render(<Harness unfilledGroupCellIds={satIds} />);
    expect(screen.getByRole('radiogroup', { name: '만족도' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    rerender(<Harness unfilledGroupCellIds={new Set(['u1', 'u2'])} />);
    expect(screen.getByRole('radiogroup', { name: '만족도' })).not.toHaveAttribute('aria-invalid');
  });

  it('방향키로 칸을 옮기면 그룹 맵의 선택이 바뀌고 다른 그룹 답은 그대로다', () => {
    render(<Harness initialValue={{ rad1: 'u2', rad2: 'sat9' }} />);
    const group = screen.getByRole('radiogroup', { name: '만족도' });
    fireEvent.keyDown(within(group).getByRole('radio', { name: '⑨ 만족' }), { key: 'ArrowRight' });
    expect(valueOf()).toEqual({ rad1: 'u2', rad2: 'sat10' });
    expect(within(group).getByRole('radio', { name: '⑩ 매우 만족' })).toHaveFocus();
    fireEvent.keyDown(within(group).getByRole('radio', { name: '⑩ 매우 만족' }), {
      key: 'ArrowRight',
    });
    expect(valueOf()).toEqual({ rad1: 'u2', rad2: 'sat0' });
    fireEvent.keyDown(within(group).getByRole('radio', { name: '⓪ 매우 불만족' }), { key: 'End' });
    expect(valueOf()).toEqual({ rad1: 'u2', rad2: 'sat10' });
  });
});

describe('ChoiceTableResponse (mobile) — 척도 막대 비활성 칸', () => {
  // checkbox 문항 안의 radio 그룹 — 문항 최대 선택 수에 닿으면 세로 타일처럼 고르지 않은 칸이 비활성이다
  function maxedQuestion(): Question {
    const base = question('checkbox', { type: 'radio', mobileScaleBar: true });
    return { ...base, maxSelections: 1 };
  }

  it('비활성 칸은 누를 수 없고, 눌러도 답이 써지지 않는다', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse question={maxedQuestion()} value={{ rad1: ['u1'] }} onChange={onChange} />,
    );
    const group = screen.getByRole('radiogroup', { name: '만족도' });
    const seven = within(group).getByRole('radio', { name: '⑦ 만족' });
    expect(seven).toBeDisabled();
    fireEvent.click(within(group).getByText('⑦'));
    fireEvent.keyDown(within(group).getByRole('radio', { name: '⑥ 만족' }), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('상한 전에는 막대 칸이 모두 활성이다', () => {
    render(<ChoiceTableResponse question={maxedQuestion()} value={{}} onChange={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: '만족도' });
    for (const radio of within(group).getAllByRole('radio')) expect(radio).toBeEnabled();
  });
});
