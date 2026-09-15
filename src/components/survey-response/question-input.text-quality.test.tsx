import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { QuestionInput } from '@/components/survey-response/question-input';
import type { Question } from '@/types/survey';

function q(type: 'text' | 'textarea', overrides: Partial<Question> = {}): Question {
  return { id: 'q1', type, title: '의견', required: false, order: 0, ...overrides } as Question;
}

describe('단답형·장문형 응답 품질 문구', () => {
  it('장문형은 치는 동안 입력칸 아래에 최소 글자 수 위반을 보인다', () => {
    render(
      <QuestionInput
        question={q('textarea', { textValidation: { minLength: 10 } })}
        value="짧은 답"
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('text-quality-violation')).toHaveTextContent(
      '10자 이상 입력해 주세요. (현재 3자, 공백 제외)',
    );
  });

  it('단답형(평문 모드)도 같은 자리에 의미 없는 입력 문구를 보인다', () => {
    render(
      <QuestionInput
        question={q('text', { textValidation: { rejectMeaningless: true } })}
        value="ㅋㅋㅋ"
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('text-quality-violation')).toHaveTextContent(
      '자음·모음이나 숫자만으로는 답할 수 없습니다.',
    );
  });

  it('통과하는 값·빈 값에는 문구가 없다', () => {
    const { rerender } = render(
      <QuestionInput
        question={q('textarea', { textValidation: { minLength: 5, rejectMeaningless: true } })}
        value="충분히 긴 답변입니다"
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId('text-quality-violation')).toBeNull();
    rerender(
      <QuestionInput
        question={q('textarea', { textValidation: { minLength: 5, rejectMeaningless: true } })}
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId('text-quality-violation')).toBeNull();
  });

  it('포커스 중에는 문구를 숨긴다 — 한글 조합 중 첫 자모(ㅇ)에 반응하지 않게', async () => {
    const user = userEvent.setup();
    render(
      <QuestionInput
        question={q('textarea', { textValidation: { rejectMeaningless: true } })}
        value="ㅇ"
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('text-quality-violation')).toBeInTheDocument();
    await user.click(screen.getByRole('textbox'));
    expect(screen.queryByTestId('text-quality-violation')).toBeNull();
    await user.tab();
    expect(screen.getByTestId('text-quality-violation')).toBeInTheDocument();
  });

  it('입력 상한이 있으면 단답형·장문형 모두 maxLength 로 막고 「현재 / 최대자」를 보인다', () => {
    render(
      <QuestionInput
        question={q('textarea', { textValidation: { maxLength: 20 } })}
        value="다섯 글자"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '20');
    expect(screen.getByTestId('text-length-counter')).toHaveTextContent('5 / 20자');
  });

  it('숫자 모드 단답형에는 상한을 걸지 않는다 — 자기 규칙이 있다', () => {
    render(
      <QuestionInput
        question={q('text', { inputType: 'number', textValidation: { maxLength: 3 } })}
        value="12"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('textbox')).not.toHaveAttribute('maxlength');
    expect(screen.queryByTestId('text-length-counter')).toBeNull();
  });

  it('배너에는 품질 이슈를 다시 싣지 않는다 — 입력칸 아래 문구 하나로 충분하다', () => {
    render(
      <QuestionInput
        question={q('textarea', { textValidation: { minLength: 10 } })}
        value="짧다"
        onChange={() => {}}
        numericIssues={[
          { kind: 'text-quality', message: '10자 이상 입력해 주세요. (현재 2자, 공백 제외)' },
        ]}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText(/10자 이상/)).toHaveLength(1);
  });
});
