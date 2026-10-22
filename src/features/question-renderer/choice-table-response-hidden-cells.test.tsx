import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Question, QuestionConditionGroup, TableRow } from '@/types/survey';

import { ChoiceTableResponse } from './choice-table-response';

// 보기 소스 표 — 숨은 칸(행·열 조건, 고르지 않은 동적 행)은 데스크톱과 모든 모바일 표시 방식에서
// 똑같이 숨는다. 저장 경계 strip 이 같은 투영으로 숨은 칸의 답을 지우므로, 한 화면이라도 숨은 행을
// 그리면 그 화면 응답자가 고른 보기가 제출에서 사라진다.

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

beforeEach(() => {
  view.mobile = false;
});

const showWhenYes: QuestionConditionGroup = {
  logicType: 'AND',
  conditions: [
    {
      id: 'c-yes',
      enabled: true,
      logicType: 'AND',
      conditionType: 'value-match',
      sourceQuestionId: 'q17',
      requiredValues: ['1'],
    },
  ],
};

const source: Question = {
  id: 'q17',
  type: 'radio',
  title: '앞 문항',
  required: true,
  order: 0,
  options: [
    { id: 'o1', label: '예', value: '1' },
    { id: 'o2', label: '아니오', value: '2' },
  ],
};

function row(rowId: string, label: string, extra: Partial<TableRow> = {}): TableRow {
  return {
    id: rowId,
    label,
    ...extra,
    cells: [
      { id: `${rowId}-label`, type: 'text', content: label },
      {
        id: `${rowId}-opt`,
        type: 'choice_opt',
        content: '',
        choiceLabel: label,
        allowTextInput: true,
      },
    ],
  };
}

function question(extra: Partial<Question> = {}): Question {
  return {
    id: 'q18',
    type: 'checkbox',
    title: '보기 소스 표',
    required: true,
    order: 1,
    optionsSource: 'table',
    maxSelections: 3,
    tableColumns: [
      { id: 'c-label', label: '항목' },
      { id: 'c-opt', label: '선택' },
    ],
    tableRowsData: [
      row('r1', '숨는 행', { displayCondition: showWhenYes }),
      row('r2', '보이는 행'),
    ],
    ...extra,
  } as Question;
}

const hiddenResponses = { q17: '2' };

describe('행 표시조건 — 모든 표시 방식에서 같은 행이 숨는다', () => {
  it.each(['auto', 'row-cards', 'axis-cards', 'original'] as const)(
    '모바일 %s 에서 숨은 행의 보기를 그리지 않는다',
    (mode) => {
      view.mobile = true;
      render(
        <ChoiceTableResponse
          question={question({ mobileTableDisplayMode: mode })}
          value={[]}
          onChange={vi.fn()}
          allResponses={hiddenResponses}
          allQuestions={[source, question()]}
        />,
      );
      expect(screen.queryByText('숨는 행')).toBeNull();
      expect(screen.getAllByText('보이는 행').length).toBeGreaterThan(0);
    },
  );

  it('모바일 선택 행 원본 보기(드릴다운) 목차에서도 숨은 행이 빠진다', () => {
    view.mobile = true;
    render(
      <ChoiceTableResponse
        question={question({ mobileTableDisplayMode: 'drilldown-original-row' })}
        value={[]}
        onChange={vi.fn()}
        allResponses={hiddenResponses}
        allQuestions={[source, question()]}
      />,
    );
    expect(screen.queryByRole('button', { name: /숨는 행/ })).toBeNull();
    expect(screen.getByRole('button', { name: /보이는 행/ })).toBeInTheDocument();
  });
});

describe('숨은 칸의 선택', () => {
  it('개수에 세지 않고 상세기재 입력칸도 그리지 않는다', () => {
    render(
      <ChoiceTableResponse
        question={question()}
        value={['r1-opt', 'r2-opt']}
        onChange={vi.fn()}
        allResponses={{ ...hiddenResponses, q18: ['r1-opt', 'r2-opt'] }}
        allQuestions={[source, question()]}
      />,
    );
    expect(screen.getByText('1/3개 선택됨')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });
});

describe('동적 행 — 데스크톱도 고른 행만 그린다', () => {
  const dynamic = question({
    tableRowsData: [
      row('d1', '동적 1', { dynamicGroupId: 'dg' }),
      row('d2', '동적 2', { dynamicGroupId: 'dg' }),
      row('r3', '고정 행'),
    ],
    dynamicRowConfigs: [{ groupId: 'dg', enabled: true, label: '항목 고르기' }],
  });

  it('고르지 않은 동적 행은 숨고, 고르는 버튼이 표 위에 있다', () => {
    const onSelect = vi.fn();
    render(
      <ChoiceTableResponse
        question={dynamic}
        value={[]}
        onChange={vi.fn()}
        allResponses={{}}
        allQuestions={[dynamic]}
        selectedDynamicRowIds={['d1']}
        onDynamicRowSelectionChange={onSelect}
      />,
    );
    expect(screen.getByText('동적 1')).toBeInTheDocument();
    expect(screen.queryByText('동적 2')).toBeNull();
    expect(screen.getByText('고정 행')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /항목 고르기/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('모바일 자동 카드도 같은 행만 그린다', () => {
    view.mobile = true;
    render(
      <ChoiceTableResponse
        question={{ ...dynamic, mobileTableDisplayMode: 'auto' }}
        value={[]}
        onChange={vi.fn()}
        allResponses={{}}
        allQuestions={[dynamic]}
        selectedDynamicRowIds={[]}
        onDynamicRowSelectionChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('동적 1')).toBeNull();
    expect(screen.getByRole('button', { name: /항목 고르기/ })).toBeInTheDocument();
  });
});
