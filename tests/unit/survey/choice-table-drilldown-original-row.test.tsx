import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import type { Question } from '@/types/survey';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/lib/survey/contact-attrs-context', () => ({ useContactAttrs: () => ({}) }));

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

function multiChoiceRowQuestion(): Question {
  return {
    id: 'q-choice',
    type: 'checkbox',
    title: '플랫폼 지표 선택',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'drilldown-original-row',
    mobileDrilldownOmitLeadingColumns: 1,
    tableColumns: [
      { id: 'c0', label: '항목' },
      { id: 'c1', label: '활성' },
      { id: 'c2', label: '재방문' },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'label', type: 'text', content: '플랫폼 지표' },
          {
            id: 'choice-active',
            type: 'choice_opt',
            content: '',
            choiceLabel: '활성 사용자',
          },
          {
            id: 'choice-return',
            type: 'choice_opt',
            content: '',
            choiceLabel: '재방문 사용자',
          },
        ],
      },
    ],
  };
}

function hiddenChoiceQuestion(): Question {
  return {
    ...multiChoiceRowQuestion(),
    id: 'q-hidden',
    type: 'radio',
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'label', type: 'text', content: '지표' },
          {
            id: 'choice-hidden',
            type: 'choice_opt',
            content: '숨길 셀 라벨',
            choiceLabel: '선택',
            mobileDisplay: 'hidden',
          },
        ],
      },
    ],
    tableColumns: [
      { id: 'c0', label: '항목' },
      { id: 'c1', label: '선택' },
    ],
  };
}

function enterRow(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
}

function ControlledChoiceTable() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <ChoiceTableResponse
      question={{ ...multiChoiceRowQuestion(), minSelections: 1, maxSelections: 2 }}
      value={value}
      onChange={(next) => setValue(Array.isArray(next) ? next : [])}
    />
  );
}

it('한 행에 choice_opt가 여러 개여도 카드는 하나이고 카드 탭은 응답을 바꾸지 않는다', () => {
  const onChange = vi.fn();
  render(
    <ChoiceTableResponse question={multiChoiceRowQuestion()} value={[]} onChange={onChange} />,
  );
  expect(screen.getAllByRole('button', { name: /플랫폼 지표/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /플랫폼 지표/ }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
});

it('상세 choice input만 기존 cell.id 배열을 저장한다', () => {
  const onChange = vi.fn();
  render(
    <ChoiceTableResponse question={multiChoiceRowQuestion()} value={[]} onChange={onChange} />,
  );
  enterRow('플랫폼 지표');
  fireEvent.click(screen.getByLabelText('활성 사용자'));
  expect(onChange).toHaveBeenCalledWith(['choice-active']);
});

it('mobileDisplay hidden choice는 라벨을 숨기지만 control을 유지한다', () => {
  render(<ChoiceTableResponse question={hiddenChoiceQuestion()} value={null} onChange={vi.fn()} />);
  enterRow('지표');
  expect(screen.queryByText('숨길 셀 라벨')).toBeNull();
  expect(screen.getByRole('radio', { name: '선택' })).toBeInTheDocument();
});

it('선택 후 현재 상세를 유지하고 카드 badge와 기존 min/max footer만 갱신한다', () => {
  render(<ControlledChoiceTable />);
  expect(screen.getByText('0/2개 선택됨')).toBeInTheDocument();
  expect(screen.getByText('최소 1개 이상 선택해주세요')).toBeInTheDocument();

  enterRow('플랫폼 지표');
  fireEvent.click(screen.getByLabelText('활성 사용자'));

  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.getByText('1/2개 선택됨')).toBeInTheDocument();
  expect(screen.queryByText(/^전체 /)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '목차로' }));
  expect(screen.getByRole('button', { name: /플랫폼 지표.*1\/2/ })).toBeInTheDocument();
});
