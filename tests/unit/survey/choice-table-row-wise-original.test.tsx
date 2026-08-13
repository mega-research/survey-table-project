import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import type { Question } from '@/types/survey';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/lib/survey/contact-attrs-context', () => ({
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

const question: Question = {
  id: 'choice-question',
  type: 'checkbox',
  title: '희망 분야',
  required: false,
  order: 0,
  mobileTableDisplayMode: 'row-wise-original',
  mobileDrilldownOmitLeadingColumns: 1,
  tableColumns: [
    { id: 'label', label: '분야', width: 180 },
    { id: 'choice', label: '선택', width: 220 },
  ],
  tableRowsData: [
    {
      id: 'row-1',
      label: '제품',
      cells: [
        { id: 'label-1', type: 'text', content: '제품' },
        { id: 'choice-1', type: 'choice_opt', content: '', choiceLabel: '제품 선택' },
      ],
    },
    {
      id: 'row-2',
      label: '연구',
      cells: [
        { id: 'label-2', type: 'text', content: '연구' },
        { id: 'choice-2', type: 'choice_opt', content: '', choiceLabel: '연구 선택' },
      ],
    },
  ],
};

describe('ChoiceTableResponse row-wise-original', () => {
  it('choice 행을 모두 나열하고 기존 cell.id 배열 응답을 유지한다', () => {
    const onChange = vi.fn();
    render(<ChoiceTableResponse question={question} value={[]} onChange={onChange} />);

    expect(screen.getByTestId('mobile-row-wise-original-sheet')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '제품' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '연구' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: '연구 선택' }));
    expect(onChange).toHaveBeenLastCalledWith(['choice-2']);
  });

  it('조건부로 숨은 행은 새 모드의 행 문항에서 제외한다', () => {
    const sourceQuestion = {
      id: 'visibility-source',
      type: 'radio',
      title: '표시 여부',
      required: false,
      order: 0,
      options: [{ id: 'show', label: '표시', value: 'show' }],
    } as Question;
    const conditionalQuestion = structuredClone(question);
    conditionalQuestion.tableRowsData![1]!.displayCondition = {
      logicType: 'AND',
      conditions: [{
        id: 'show-research',
        sourceQuestionId: sourceQuestion.id,
        conditionType: 'value-match',
        logicType: 'AND',
        requiredValues: ['show'],
      }],
    };

    render(
      <ChoiceTableResponse
        question={conditionalQuestion}
        value={[]}
        onChange={vi.fn()}
        allResponses={{ [sourceQuestion.id]: 'hide' }}
        allQuestions={[sourceQuestion, conditionalQuestion]}
      />,
    );

    expect(screen.getByRole('group', { name: '제품' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '연구' })).toBeNull();
  });

  it('radio 그룹도 기존 groupKey 응답 shape와 그룹 name을 유지한다', () => {
    const radioQuestion = structuredClone(question);
    radioQuestion.type = 'radio';
    radioQuestion.choiceGroups = [
      { id: 'field-group', type: 'radio', groupKey: 'field', label: '분야' },
    ];
    for (const row of radioQuestion.tableRowsData ?? []) {
      const choiceCell = row.cells.find((cell) => cell.type === 'choice_opt');
      if (choiceCell) choiceCell.choiceGroupId = 'field-group';
    }
    const onChange = vi.fn();

    render(
      <ChoiceTableResponse
        question={radioQuestion}
        value={{}}
        onChange={onChange}
      />,
    );

    const product = screen.getByRole('radio', { name: '제품 선택' });
    const research = screen.getByRole('radio', { name: '연구 선택' });
    expect(product).toHaveAttribute('name', research.getAttribute('name'));
    fireEvent.click(research);
    expect(onChange).toHaveBeenLastCalledWith({ field: 'choice-2' });
  });

  it('choice 동적 행은 사이드카 선택만 작성 순서로 표시하고 원래 응답 shape를 유지한다', () => {
    const dynamicQuestion = structuredClone(question);
    dynamicQuestion.tableRowsData![1]!.dynamicGroupId = 'research';
    dynamicQuestion.dynamicRowConfigs = [
      { groupId: 'research', enabled: true, label: '연구 항목 선택' },
    ];
    const onDynamicRowsChange = vi.fn();
    const onChange = vi.fn();

    const { rerender } = render(
      <ChoiceTableResponse
        question={dynamicQuestion}
        value={[]}
        onChange={onChange}
        selectedDynamicRowIds={[]}
        onDynamicRowSelectionChange={onDynamicRowsChange}
      />,
    );

    expect(screen.getByRole('group', { name: '제품' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '연구' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /연구 항목 선택.*0개 선택/ }));
    fireEvent.click(screen.getByText('연구', { selector: 'span' }));
    fireEvent.click(screen.getByRole('button', { name: '확인 (1개)' }));
    expect(onDynamicRowsChange).toHaveBeenLastCalledWith(['row-2']);
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <ChoiceTableResponse
        question={dynamicQuestion}
        value={[]}
        onChange={onChange}
        selectedDynamicRowIds={['row-2']}
        onDynamicRowSelectionChange={onDynamicRowsChange}
      />,
    );
    expect(
      [...document.querySelectorAll('[data-row-question-id]')].map((row) =>
        row.getAttribute('data-row-question-id'),
      ),
    ).toEqual(['row-1', 'row-2']);
  });
});
