import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BranchRuleEditor } from '@/features/survey-builder/branch-rule-editor';
import type { BranchRule, Question } from '@/types/survey';

const allQuestions: Question[] = [
  { id: 'q1', surveyId: 's1', type: 'radio', title: 'Q1', required: false, order: 0 } as Question,
  { id: 'q2', surveyId: 's1', type: 'radio', title: 'Q2', required: false, order: 1 } as Question,
];

function renderEditor(branchRule: BranchRule | undefined, onChange = vi.fn()) {
  render(
    <BranchRuleEditor
      branchRule={branchRule}
      allQuestions={allQuestions}
      currentQuestionId="q1"
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('BranchRuleEditor 종료 결과 선택', () => {
  it('설문 종료를 고르면 종료 결과 선택이 나타난다', async () => {
    const user = userEvent.setup();
    renderEditor({ id: 'br-1', value: '', action: 'goto', targetQuestionId: 'q2' });

    await user.click(screen.getByText('설문 종료'));

    expect(screen.getByText('응답 완료')).toBeInTheDocument();
    expect(screen.getByText('자격 미달')).toBeInTheDocument();
  });

  it('설문 종료의 기본 종료 결과는 응답 완료다', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ id: 'br-1', value: '', action: 'goto', targetQuestionId: 'q2' });

    await user.click(screen.getByText('설문 종료'));

    const last = onChange.mock.calls.at(-1)?.[0] as BranchRule;
    expect(last.action).toBe('end');
    expect(last.endOutcome).toBe('completed');
  });

  it('자격 미달을 고르면 endOutcome 이 screened_out 으로 전달된다', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ id: 'br-1', value: '', action: 'end', endOutcome: 'completed' });

    await user.click(screen.getByText('자격 미달'));

    const last = onChange.mock.calls.at(-1)?.[0] as BranchRule;
    expect(last.endOutcome).toBe('screened_out');
  });

  it('질문 이동으로 되돌리면 endOutcome 을 싣지 않는다', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ id: 'br-1', value: '', action: 'end', endOutcome: 'screened_out' });

    await user.click(screen.getByText('질문 이동'));

    const last = onChange.mock.calls.at(-1)?.[0] as BranchRule;
    expect(last.action).toBe('goto');
    expect(last.endOutcome).toBeUndefined();
  });

  it('저장된 endOutcome 을 열면 그 값이 선택된 상태로 복원된다', () => {
    renderEditor({ id: 'br-1', value: '', action: 'end', endOutcome: 'screened_out' });

    expect(screen.getByRole('button', { name: /자격 미달/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
