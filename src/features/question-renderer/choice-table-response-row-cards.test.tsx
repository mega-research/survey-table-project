import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Question } from '@/types/survey';

import { ChoiceTableResponse } from './choice-table-response';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
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

function question(): Question {
  return {
    id: 'q',
    type: 'radio',
    title: '참여 여부',
    required: true,
    order: 0,
    mobileTableDisplayMode: 'row-cards',
    choiceGroups: [
      { id: 'past', groupKey: 'rad1', type: 'radio', label: '현재 활용' },
      { id: 'future', groupKey: 'rad2', type: 'radio', label: '활용 계획' },
    ],
    tableColumns: [
      { id: 'item', label: '항목' },
      { id: 'description', label: '설명' },
      { id: 'past', label: '현재 활용' },
      { id: 'future', label: '활용 계획' },
    ],
    tableRowsData: ['회의실', '교통비'].map((label, i) => ({
      id: `r${i}`,
      label,
      cells: [
        { id: `title${i}`, type: 'text', content: label, mobileDisplay: 'inline' },
        { id: `desc${i}`, type: 'text', content: `${label} 지원 설명`, mobileDisplay: 'inline' },
        {
          id: `past${i}`,
          type: 'choice_opt',
          content: '',
          choiceLabel: label,
          choiceGroupId: 'past',
        },
        {
          id: `future${i}`,
          type: 'choice_opt',
          content: '',
          choiceLabel: label,
          choiceGroupId: 'future',
        },
      ],
    })),
  };
}

describe('행 단위 카드 — 축 카드 디자인, 행별 묶음 유지', () => {
  it('행 제목을 고정 헤더에 한 번 표시하고 같은 행의 축 선택을 세로 타일로 둔다', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse question={question()} value={{ rad2: 'future1' }} onChange={onChange} />,
    );
    const card = screen.getByTestId('row-card-r0');
    const header = within(card).getByTestId('row-card-header');
    expect(header).toHaveClass('sticky', 'top-0', 'bg-gray-100');
    expect(within(card).getAllByText('회의실')).toHaveLength(1);
    expect(within(card).getByText('회의실 지원 설명')).toBeInTheDocument();
    expect(within(card).getAllByRole('radio')).toHaveLength(2);
    expect(screen.getAllByTestId(/^row-card-r/)).toHaveLength(2);
    expect(screen.queryByTestId('axis-card-past')).toBeNull();
    fireEvent.click(within(card).getByRole('radio', { name: '현재 활용' }));
    expect(onChange).toHaveBeenLastCalledWith({ rad1: 'past0', rad2: 'future1' });
  });

  it('한 행에서 같은 그룹에 속한 보기들은 개별 보기 문구로 구별하고 상세기재는 카드 아래에 둔다', () => {
    const q = question();
    q.choiceGroups = [{ id: 'g', groupKey: 'rad1', type: 'radio', label: '참여 희망' }];
    q.tableRowsData = [
      {
        id: 'r',
        label: '대기업',
        cells: [
          { id: 'title', type: 'text', content: '대기업', mobileDisplay: 'header' },
          {
            id: 'yes',
            type: 'choice_opt',
            content: '①',
            choiceLabel: '희망함',
            choiceGroupId: 'g',
            allowTextInput: true,
            textInputPlaceholder: '희망 분야',
          },
          {
            id: 'no',
            type: 'choice_opt',
            content: '②',
            choiceLabel: '희망하지 않음',
            choiceGroupId: 'g',
          },
        ],
      },
    ];
    render(<ChoiceTableResponse question={q} value={{ rad1: 'yes' }} onChange={() => {}} />);
    const card = screen.getByTestId('row-card-r');
    expect(within(card).getByRole('radio', { name: '희망함' })).toBeChecked();
    expect(within(card).getByRole('radio', { name: '희망하지 않음' })).not.toBeChecked();
    expect(card).not.toContainElement(screen.getByPlaceholderText('희망 분야'));
  });

  it('보기 하나인 행과 입력 셀만 있는 행도 같은 카드 형태로 보인다', () => {
    const q = question();
    q.tableRowsData = [
      {
        id: 'one',
        label: '',
        cells: [
          { id: 'one-title', type: 'text', content: '단독 보기', mobileDisplay: 'header' },
          { id: 'one-choice', type: 'choice_opt', content: '선택', choiceGroupId: 'past' },
        ],
      },
      {
        id: 'input',
        label: '',
        cells: [
          { id: 'input-title', type: 'text', content: '추가 정보', mobileDisplay: 'header' },
          { id: 'input-cell', type: 'input', content: '', placeholder: '추가 정보 입력' },
        ],
      },
    ];
    render(<ChoiceTableResponse question={q} value={{}} onChange={() => {}} />);
    expect(within(screen.getByTestId('row-card-one')).getByRole('radio')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('row-card-input')).getByPlaceholderText('추가 정보 입력'),
    ).toBeInTheDocument();
  });

  it('축 단위 카드는 계속 축별로 묶고 각 카드 안에 행 보기를 나열한다', () => {
    render(
      <ChoiceTableResponse
        question={{ ...question(), mobileTableDisplayMode: 'axis-cards' }}
        value={{}}
        onChange={() => {}}
      />,
    );
    const card = screen.getByTestId('axis-card-past');
    expect(within(card).getByTestId('axis-card-header')).toHaveClass('sticky', 'bg-gray-100');
    expect(within(card).getByRole('radio', { name: '회의실' })).toBeInTheDocument();
    expect(within(card).getByRole('radio', { name: '교통비' })).toBeInTheDocument();
    expect(screen.queryByTestId('row-card-r0')).toBeNull();
  });
});
