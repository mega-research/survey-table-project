import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// TableOptionSelector 는 실제 옵션 셀 파생에 의존하므로 stub 처리한다.
// 검증 대상은 in-place 질문 전환 시 로컬 rules 재동기화 동작뿐이다.
vi.mock('@/components/survey-builder/table-option-selector', () => ({
  TableOptionSelector: () => null,
}));

import { TableValidationEditor } from '@/components/survey-builder/table-validation-editor';
import type { Question, TableValidationRule } from '@/types/survey';

function makeQuestion(id: string, rules: TableValidationRule[]): Question {
  return {
    id,
    surveyId: 's1',
    type: 'table',
    title: `표 질문 ${id}`,
    required: false,
    order: 0,
    tableColumns: [{ id: 'c1', label: '열1' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '행1',
        cells: [{ id: 'cell-r1-c1', type: 'checkbox' }],
      },
    ],
    tableValidationRules: rules,
  } as unknown as Question;
}

function ruleWith(id: string, description: string): TableValidationRule {
  return {
    id,
    type: 'exclusive-check',
    description,
    conditions: { checkType: 'checkbox', rowIds: [], cellColumnIndex: 0 },
    action: 'end',
  };
}

describe('TableValidationEditor in-place 질문 전환 재동기화', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('question prop 의 id 가 바뀌면 로컬 rules 가 새 질문 값으로 재동기화된다', () => {
    const qA = makeQuestion('qA', [ruleWith('ruleA', 'A 규칙')]);
    const qB = makeQuestion('qB', [ruleWith('ruleB', 'B 규칙')]);

    const { rerender, queryByText } = render(
      <TableValidationEditor question={qA} onUpdate={() => {}} allQuestions={[qA]} />,
    );

    // A 규칙이 보인다
    expect(queryByText(/A 규칙/)).not.toBeNull();
    expect(queryByText(/B 규칙/)).toBeNull();

    // 모달 remount 없이 question 만 B 로 교체 (in-place 전환)
    rerender(
      <TableValidationEditor question={qB} onUpdate={() => {}} allQuestions={[qB]} />,
    );

    // 이전 질문(A) 규칙이 남아있으면 안 되고 B 규칙이 보여야 한다
    expect(queryByText(/A 규칙/)).toBeNull();
    expect(queryByText(/B 규칙/)).not.toBeNull();
  });

  it('전환 후 규칙을 추가하면 onUpdate 가 새 질문 규칙 기반으로 호출된다(이전 질문 규칙 덮어쓰기 없음)', () => {
    const qA = makeQuestion('qA', [ruleWith('ruleA', 'A 규칙')]);
    const qB = makeQuestion('qB', [ruleWith('ruleB', 'B 규칙')]);
    const onUpdate = vi.fn();

    const { rerender, getByText } = render(
      <TableValidationEditor question={qA} onUpdate={onUpdate} allQuestions={[qA]} />,
    );

    rerender(
      <TableValidationEditor question={qB} onUpdate={onUpdate} allQuestions={[qB]} />,
    );

    onUpdate.mockClear();
    fireEvent.click(getByText('규칙 추가'));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const passed = onUpdate.mock.calls[0]![0] as TableValidationRule[];
    // 기존 B 규칙(ruleB) 위에 새 규칙이 더해져야 한다. A 규칙(ruleA)이 섞이면 안 된다.
    const ids = passed.map((r) => r.id);
    expect(ids).toContain('ruleB');
    expect(ids).not.toContain('ruleA');
    expect(passed.length).toBe(2);
  });

  it('같은 질문 내에서 reference 만 흔들려도(편집 중) 로컬 rules 가 리셋되지 않는다', () => {
    const qA = makeQuestion('qA', [ruleWith('ruleA', 'A 규칙')]);
    const onUpdate = vi.fn();

    const { rerender, getByText } = render(
      <TableValidationEditor question={qA} onUpdate={onUpdate} allQuestions={[qA]} />,
    );

    // 사용자가 규칙을 추가해 로컬 state 가 2개가 된 상태
    fireEvent.click(getByText('규칙 추가'));
    onUpdate.mockClear();

    // store 의 question reference 만 바뀐 새 객체(같은 id, 같은 원본 rules) 전달
    const qASameId = makeQuestion('qA', [ruleWith('ruleA', 'A 규칙')]);
    rerender(
      <TableValidationEditor question={qASameId} onUpdate={onUpdate} allQuestions={[qASameId]} />,
    );

    // id 가 같으므로 재동기화로 인한 리셋이 일어나면 안 된다 → 추가했던 새 규칙이 그대로 보여야 함
    // (재동기화가 잘못 발화하면 onUpdate 가 호출되거나 규칙 수가 1로 줄어든다)
    const newRule = getByText(/규칙 2/);
    expect(newRule).not.toBeNull();
  });
});
