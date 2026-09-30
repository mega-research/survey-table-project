import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Question } from '@/types/survey';

import { ChoiceTableResponse } from './choice-table-response';

/**
 * 보기 소스 표(radio/checkbox 문항 + 내장 표) — 「행 단위 그룹 카드」에서 그룹 옵션
 * (mobileOriginalLine)을 켠 그룹만 원본 한 줄로 그린다. 표 문항과 같은 옵션·같은 모양이다.
 */

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));

const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

function question(type: 'radio' | 'checkbox', originalLine: boolean): Question {
  return {
    id: 'q1',
    type,
    title: '지원제도',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'row-group-cards',
    choiceGroups: [
      { id: 'g-use', type, groupKey: 'rad1', label: '활용 여부' },
      { id: 'g-sat', type, groupKey: 'rad2', label: '만족도', mobileOriginalLine: originalLine },
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

describe('ChoiceTableResponse (mobile) — 원본 한 줄 그룹 옵션', () => {
  it('켠 그룹만 잘라 낸 헤더 + 보기 한 줄로 그리고, 다른 그룹은 세로 타일 그대로다', () => {
    render(<ChoiceTableResponse question={question('radio', true)} value={{}} onChange={() => {}} />);
    const line = screen.getByTestId('choice-group-original-line-g-sat');
    for (const label of ['만족도', '매우 불만족', '보통', '매우 만족']) {
      expect(within(line).getByText(label)).toBeInTheDocument();
    }
    expect(within(line).queryByText('활용 여부')).not.toBeInTheDocument();
    expect(within(line).getAllByRole('radio')).toHaveLength(11);
    expect(screen.queryByTestId('choice-group-original-line-g-use')).not.toBeInTheDocument();
    expect(screen.getByText('활용 안함', { selector: 'span' })).toBeInTheDocument();
  });

  it('단일 선택 — 칸을 누르면 그룹 맵에 셀 id 가 들어간다', () => {
    const onChange = vi.fn();
    render(<ChoiceTableResponse question={question('radio', true)} value={{}} onChange={onChange} />);
    fireEvent.click(within(screen.getByTestId('choice-group-original-line-g-sat')).getByText('⑦'));
    expect(onChange).toHaveBeenLastCalledWith({ rad2: 'sat7' });
  });

  it('다중 선택 — 체크박스 칸으로 그리고 배열로 쌓는다', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={question('checkbox', true)}
        value={{ rad2: ['sat1'] }}
        onChange={onChange}
      />,
    );
    const line = screen.getByTestId('choice-group-original-line-g-sat');
    expect(within(line).getAllByRole('checkbox')).toHaveLength(11);
    fireEvent.click(within(line).getByText('③'));
    expect(onChange).toHaveBeenLastCalledWith({ rad2: ['sat1', 'sat3'] });
  });

  it('옵션을 끄면 종전처럼 세로 타일이다', () => {
    render(<ChoiceTableResponse question={question('radio', false)} value={{}} onChange={() => {}} />);
    expect(screen.queryByTestId('choice-group-original-line-g-sat')).not.toBeInTheDocument();
    expect(screen.getByText('10점')).toBeInTheDocument();
  });
});
