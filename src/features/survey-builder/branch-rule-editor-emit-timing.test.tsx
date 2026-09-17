import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BranchRuleEditor } from '@/features/survey-builder/branch-rule-editor';
import type { Question } from '@/types/survey';

/**
 * BranchRuleEditor 는 로컬 편집값이 바뀔 때만 onChange 로 규칙을 밀어 올린다.
 * 호출자 3곳이 모두 인라인 onChange 를 넘기므로, onChange identity 변경(부모 재렌더)이
 * 추가 호출을 만들면 부모 setState 와 맞물려 무한 루프가 된다 — 횟수를 박제한다.
 */
const QUESTIONS = [
  { id: 'q1', type: 'radio', title: '1', required: false, order: 0 },
  { id: 'q2', type: 'text', title: '2', required: false, order: 1 },
] as unknown as Question[];

describe('BranchRuleEditor onChange 호출 횟수', () => {
  afterEach(cleanup);

  it('마운트 1회, 새 onChange identity 재렌더 0회, 토글 1회당 1회', () => {
    const first = vi.fn();
    const { rerender } = render(
      <BranchRuleEditor allQuestions={QUESTIONS} currentQuestionId="q1" onChange={first} />,
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(undefined);

    const second = vi.fn();
    rerender(<BranchRuleEditor allQuestions={QUESTIONS} currentQuestionId="q1" onChange={second} />);
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('switch'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]![0]).toMatchObject({ action: 'goto', targetQuestionId: '' });
  });
});
