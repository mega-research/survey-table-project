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

function repeatedChoiceQuestion(
  type: 'radio' | 'checkbox',
  overrides: Partial<Question> = {},
): Question {
  return {
    id: `repeat-choice-${type}`,
    type,
    title: '반복 선택 표',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'drilldown-original-row',
    mobileDrilldownOmitLeadingColumns: 1,
    mobileDrilldownRepeatHeaderStartRow: 1,
    mobileDrilldownRepeatHeaderEndRow: 1,
    tableColumns: [
      { id: 'choice-label-column', label: '항목', width: 140 },
      { id: 'choice-a-column', label: 'A', width: 120 },
      { id: 'choice-b-column', label: 'B', width: 120 },
    ],
    tableRowsData: [
      {
        id: 'repeat-choice-row',
        label: '척도 헤더',
        cells: [
          { id: 'repeat-choice-label', type: 'text', content: '척도 헤더' },
          {
            id: 'repeat-choice-a',
            type: 'choice_opt',
            content: '',
            choiceLabel: '반복 선택 A',
          },
          {
            id: 'repeat-choice-b',
            type: 'choice_opt',
            content: '',
            choiceLabel: '반복 선택 B',
          },
        ],
      },
      {
        id: 'answer-choice-row',
        label: '직무',
        cells: [
          { id: 'answer-choice-label', type: 'text', content: '직무' },
          {
            id: 'answer-choice-a',
            type: 'choice_opt',
            content: '',
            choiceLabel: '직무 선택 A',
          },
          {
            id: 'answer-choice-b',
            type: 'choice_opt',
            content: '',
            choiceLabel: '직무 선택 B',
          },
        ],
      },
    ],
    ...overrides,
  } as Question;
}

function enterRepeatedChoiceAnswer() {
  fireEvent.click(screen.getByRole('button', { name: /직무/ }));
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

function ControlledRepeatedChoiceRowspanAnchor() {
  const [value, setValue] = useState<string | null>(null);
  const question: Question = {
    id: 'repeat-choice-anchor-question',
    type: 'radio',
    title: '반복 선택 승격',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'drilldown-original-row',
    mobileDrilldownOmitLeadingColumns: 2,
    mobileDrilldownRepeatHeaderStartRow: 1,
    mobileDrilldownRepeatHeaderEndRow: 1,
    tableColumns: [
      { id: 'repeat-choice-anchor-section-column', label: '섹션' },
      { id: 'repeat-choice-anchor-item-column', label: '항목' },
      { id: 'repeat-choice-anchor-value-column', label: '선택' },
    ],
    tableRowsData: [
      {
        id: 'repeat-choice-anchor-header-row',
        label: '반복 헤더',
        cells: [
          {
            id: 'repeat-choice-anchor-section',
            type: 'text',
            content: '승격 선택 섹션',
            rowspan: 3,
          },
          { id: 'repeat-choice-anchor-header-label', type: 'text', content: '반복 헤더' },
          {
            id: 'repeat-choice-anchor-option',
            type: 'choice_opt',
            content: '',
            choiceLabel: '승격 선택지',
            rowspan: 2,
          },
        ],
      },
      {
        id: 'repeat-choice-anchor-promoted-row',
        label: '승격 선택 항목',
        cells: [
          {
            id: 'repeat-choice-anchor-section-continuation-1',
            type: 'text',
            content: '',
            isHidden: true,
            _isContinuation: true,
          },
          {
            id: 'repeat-choice-anchor-promoted-label',
            type: 'text',
            content: '승격 선택 항목',
          },
          {
            id: 'repeat-choice-anchor-option-continuation',
            type: 'choice_opt',
            content: '',
            isHidden: true,
            _isContinuation: true,
          },
        ],
      },
      {
        id: 'repeat-choice-anchor-normal-row',
        label: '일반 선택 항목',
        cells: [
          {
            id: 'repeat-choice-anchor-section-continuation-2',
            type: 'text',
            content: '',
            isHidden: true,
            _isContinuation: true,
          },
          {
            id: 'repeat-choice-anchor-normal-label',
            type: 'text',
            content: '일반 선택 항목',
          },
          {
            id: 'repeat-choice-anchor-normal-option',
            type: 'choice_opt',
            content: '',
            choiceLabel: '일반 선택지',
          },
        ],
      },
    ],
  };

  return (
    <ChoiceTableResponse
      question={question}
      value={value}
      onChange={(next) => setValue(typeof next === 'string' ? next : null)}
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

it('hidden-label control은 44px label target 전체로 선택할 수 있다', () => {
  const onChange = vi.fn();
  render(
    <ChoiceTableResponse question={hiddenChoiceQuestion()} value={null} onChange={onChange} />,
  );
  enterRow('지표');
  const control = screen.getByRole('radio', { name: '선택' });
  const target = control.closest('label');
  expect(target).not.toBeNull();
  expect(target).toHaveClass('min-h-11', 'min-w-11');
  fireEvent.click(target!);
  expect(onChange).toHaveBeenCalledWith('choice-hidden');
});

it('hidden-label checkbox도 44px label target 전체로 선택할 수 있다', () => {
  const onChange = vi.fn();
  const question = { ...hiddenChoiceQuestion(), type: 'checkbox' as const };
  render(<ChoiceTableResponse question={question} value={[]} onChange={onChange} />);
  enterRow('지표');
  const control = screen.getByRole('checkbox', { name: '선택' });
  const target = control.closest('label');
  expect(target).not.toBeNull();
  expect(target).toHaveClass('min-h-11', 'min-w-11');
  fireEvent.click(target!);
  expect(onChange).toHaveBeenCalledWith(['choice-hidden']);
});

it('선택 후 현재 상세를 유지하고 전체·카드 상태와 기존 min/max footer를 갱신한다', () => {
  render(<ControlledChoiceTable />);
  expect(screen.getByText('0/2개 선택됨')).toBeInTheDocument();
  expect(screen.getByText('최소 1개 이상 선택해주세요')).toBeInTheDocument();

  enterRow('플랫폼 지표');
  fireEvent.click(screen.getByLabelText('활성 사용자'));

  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.getByText('1/2개 선택됨')).toBeInTheDocument();
  expect(screen.getByText(/^전체 /)).toHaveTextContent('전체 1 / 2개 선택');

  fireEvent.click(screen.getByRole('button', { name: '목차로' }));
  expect(screen.getByRole('button', { name: /플랫폼 지표.*1\/2/ })).toBeInTheDocument();
});

it.each(['radio', 'checkbox'] as const)(
  '%s 설명 테이블에서 반복 본문 행을 목차에서 빼고 disabled control로 상세에 표시한다',
  (type) => {
    render(
      <ChoiceTableResponse
        question={repeatedChoiceQuestion(type)}
        value={type === 'checkbox' ? [] : null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /척도 헤더/ })).toBeNull();
    enterRepeatedChoiceAnswer();
    const repeatControl = screen.getByRole(type, { name: '반복 선택 A' });
    const answerControl = screen.getByRole(type, { name: '직무 선택 A' });
    expect(repeatControl).toBeDisabled();
    expect(answerControl).toBeEnabled();
  },
);

it('choice 반복행의 interactive rowspan anchor를 승격한 행으로 전체·섹션·항목 상태를 계산한다', () => {
  render(<ControlledRepeatedChoiceRowspanAnchor />);

  const sectionButton = screen.getByRole('button', { name: /승격 선택 섹션/ });
  expect(sectionButton).toHaveTextContent('0/2');
  expect(screen.getByText(/전체/)).toHaveTextContent('전체 0 / 2개 선택');
  fireEvent.click(sectionButton);

  const promotedLeafButton = screen.getByRole('button', { name: /승격 선택 항목/ });
  expect(promotedLeafButton).toHaveTextContent('0/1');
  fireEvent.click(promotedLeafButton);

  const promotedControls = screen.getAllByRole('radio', { name: '승격 선택지' });
  expect(promotedControls).toHaveLength(2);
  expect(promotedControls[0]).toBeDisabled();
  expect(promotedControls[1]).toBeEnabled();
  fireEvent.click(promotedControls[1]!);
  expect(screen.getByText(/전체/)).toHaveTextContent('전체 1 / 2개 선택');

  fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
  expect(screen.getByRole('button', { name: /승격 선택 항목/ })).toHaveTextContent('1/1');
});

it('0-2는 다단 헤더와 본문 1~2행을 같은 열 투영으로 보여준다', () => {
  const question = repeatedChoiceQuestion('checkbox', {
    mobileDrilldownRepeatHeaderStartRow: 0,
    mobileDrilldownRepeatHeaderEndRow: 2,
    tableHeaderGrid: [
      [
        { id: 'item-header', label: '항목', colspan: 1, rowspan: 1 },
        { id: 'scale-header', label: '척도', colspan: 2, rowspan: 1 },
      ],
    ],
    tableRowsData: [
      {
        id: 'first-repeat-row',
        label: '제외할 첫 반복 행 제목',
        cells: [
          {
            id: 'first-repeat-label',
            type: 'text',
            content: '제외할 첫 반복 행 제목',
          },
          { id: 'first-repeat-a', type: 'text', content: '본문 헤더 1A' },
          { id: 'first-repeat-b', type: 'text', content: '본문 헤더 1B' },
        ],
      },
      {
        id: 'second-repeat-row',
        label: '제외할 둘째 반복 행 제목',
        cells: [
          {
            id: 'second-repeat-label',
            type: 'text',
            content: '제외할 둘째 반복 행 제목',
          },
          { id: 'second-repeat-a', type: 'text', content: '본문 헤더 2A' },
          { id: 'second-repeat-b', type: 'text', content: '본문 헤더 2B' },
        ],
      },
      repeatedChoiceQuestion('checkbox').tableRowsData![1]!,
    ],
  });
  render(<ChoiceTableResponse question={question} value={[]} onChange={vi.fn()} />);
  enterRepeatedChoiceAnswer();
  expect(screen.getByRole('columnheader', { name: '척도' })).toBeInTheDocument();
  expect(screen.getByText('본문 헤더 1A')).toBeInTheDocument();
  expect(screen.getByText('본문 헤더 2B')).toBeInTheDocument();
  expect(screen.queryByText('제외할 첫 반복 행 제목')).toBeNull();
  expect(screen.queryByText('제외할 둘째 반복 행 제목')).toBeNull();
});

it('헤더 grid와 열 label이 모두 없으면 0만 건너뛰고 지정 본문 행을 반복한다', () => {
  const question = repeatedChoiceQuestion('checkbox', {
    mobileDrilldownRepeatHeaderStartRow: 0,
    mobileDrilldownRepeatHeaderEndRow: 1,
    mobileDrilldownOmitLeadingColumns: 0,
    tableColumns: [
      { id: 'blank-label', label: '' },
      { id: 'blank-a', label: '' },
      { id: 'blank-b', label: '' },
    ],
  });
  render(<ChoiceTableResponse question={question} value={[]} onChange={vi.fn()} />);
  enterRepeatedChoiceAnswer();
  expect(screen.queryByRole('columnheader')).toBeNull();
  expect(screen.getByText('척도 헤더')).toBeInTheDocument();
});

it('그룹 혼합 choice 반복행은 셀별 radio/checkbox 모양을 유지하되 모두 비활성화한다', () => {
  const question = repeatedChoiceQuestion('radio', {
    choiceGroups: [
      { id: 'repeat-radio-group', type: 'radio', groupKey: 'radio', label: '라디오' },
      { id: 'repeat-check-group', type: 'checkbox', groupKey: 'check', label: '체크' },
    ],
    tableRowsData: [
      {
        id: 'repeat-choice-row',
        label: '척도 헤더',
        cells: [
          { id: 'repeat-choice-label', type: 'text', content: '척도 헤더' },
          {
            id: 'repeat-choice-a',
            type: 'choice_opt',
            content: '',
            choiceLabel: '반복 라디오',
            choiceGroupId: 'repeat-radio-group',
          },
          {
            id: 'repeat-choice-b',
            type: 'choice_opt',
            content: '',
            choiceLabel: '반복 체크박스',
            choiceGroupId: 'repeat-check-group',
          },
        ],
      },
      {
        id: 'answer-choice-row',
        label: '직무',
        cells: [
          { id: 'answer-choice-label', type: 'text', content: '직무' },
          {
            id: 'answer-choice-a',
            type: 'choice_opt',
            content: '',
            choiceLabel: '직무 라디오',
            choiceGroupId: 'repeat-radio-group',
          },
          {
            id: 'answer-choice-b',
            type: 'choice_opt',
            content: '',
            choiceLabel: '직무 체크박스',
            choiceGroupId: 'repeat-check-group',
          },
        ],
      },
    ],
  });
  render(<ChoiceTableResponse question={question} value={{}} onChange={vi.fn()} />);
  enterRepeatedChoiceAnswer();
  expect(screen.getByRole('radio', { name: '반복 라디오' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: '반복 체크박스' })).toBeDisabled();
});

it('choice는 기존처럼 행 displayCondition을 평가하지 않고 반복행으로 표시한다', () => {
  const question = repeatedChoiceQuestion('checkbox');
  question.tableRowsData![0]!.displayCondition = {
    logicType: 'AND',
    conditions: [
      {
        id: 'choice-repeat-hidden-condition',
        sourceQuestionId: 'missing-source',
        conditionType: 'value-match',
        logicType: 'AND',
        requiredValues: ['show'],
      },
    ],
  };
  render(<ChoiceTableResponse question={question} value={[]} onChange={vi.fn()} />);
  enterRepeatedChoiceAnswer();
  expect(screen.getByRole('checkbox', { name: '반복 선택 A' })).toBeDisabled();
});
