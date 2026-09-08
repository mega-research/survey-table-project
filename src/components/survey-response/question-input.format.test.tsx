import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { QuestionInput } from '@/components/survey-response/question-input';
import { PriorAnswersProvider } from '@/lib/survey/prior-answers-context';
import type { Question } from '@/types/survey';

function textQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'text',
    title: '휴대전화',
    required: false,
    order: 0,
    ...overrides,
  } as Question;
}

/** 응답값을 실제로 들고 있는 얇은 래퍼 — 정돈된 값이 저장으로 흘러가는지 보려면 필요하다. */
function Harness({
  question,
  initialValue = '',
  prior = null,
}: {
  question: Question;
  initialValue?: string;
  prior?: Record<string, unknown> | null;
}) {
  const [value, setValue] = useState<unknown>(initialValue);
  return (
    <PriorAnswersProvider
      answers={prior}
      confirmAnswers={prior}
      waveLabel={null}
      changeConfirmEnabled={false}
    >
      <QuestionInput question={question} value={value} onChange={setValue} />
      <output data-testid="stored">{typeof value === 'string' ? value : ''}</output>
    </PriorAnswersProvider>
  );
}

describe('단답형 입력 형식', () => {
  it('타이핑 중에는 건드리지 않고 blur 시 정돈한다', async () => {
    const user = userEvent.setup();
    render(<Harness question={textQuestion({ inputType: 'mobile' })} />);
    const input = screen.getByRole('textbox');

    await user.type(input, '010 1234 5678');
    expect(input).toHaveValue('010 1234 5678');
    expect(screen.getByTestId('stored')).toHaveTextContent('010 1234 5678');

    await user.tab();
    expect(input).toHaveValue('010-1234-5678');
    expect(screen.getByTestId('stored')).toHaveTextContent('010-1234-5678');
  });

  it('형식이 틀리면 blur 후 사유 문구가 칸 아래 뜨고, 값은 그대로 둔다', async () => {
    const user = userEvent.setup();
    render(<Harness question={textQuestion({ inputType: 'mobile' })} />);
    const input = screen.getByRole('textbox');

    await user.type(input, '02-1234-5678');
    expect(screen.queryByText(/휴대전화 번호가 아닙니다/)).not.toBeInTheDocument();

    await user.tab();
    expect(screen.getByText(/휴대전화 번호가 아닙니다/)).toBeInTheDocument();
    expect(input).toHaveValue('02-1234-5678');
  });

  it('다시 고치기 시작하면 문구가 사라진다', async () => {
    const user = userEvent.setup();
    render(<Harness question={textQuestion({ inputType: 'email' })} />);
    const input = screen.getByRole('textbox');

    await user.type(input, 'nobody@nowhere');
    await user.tab();
    expect(screen.getByText(/이메일 형식이 아닙니다/)).toBeInTheDocument();

    await user.click(input);
    expect(screen.queryByText(/이메일 형식이 아닙니다/)).not.toBeInTheDocument();
  });

  it('형식을 지정하지 않은 단답형은 blur 해도 값이 바뀌지 않는다', async () => {
    const user = userEvent.setup();
    render(<Harness question={textQuestion()} />);
    const input = screen.getByRole('textbox');

    await user.type(input, '010 1234 5678');
    await user.tab();
    expect(input).toHaveValue('010 1234 5678');
  });

  it('예시 값이 placeholder 로 보인다', () => {
    render(<Harness question={textQuestion({ inputType: 'biz_number' })} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '123-45-67891');
  });

  it('이월 원본 그대로면 검사도 정돈도 하지 않는다', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        question={textQuestion({ inputType: 'mobile' })}
        initialValue="02-1234-5678"
        prior={{ q1: '02-1234-5678' }}
      />,
    );
    const input = screen.getByRole('textbox');

    await user.click(input);
    await user.tab();
    expect(input).toHaveValue('02-1234-5678');
    expect(screen.queryByText(/휴대전화 번호가 아닙니다/)).not.toBeInTheDocument();
  });

  it('이월 값을 한 글자라도 고치면 그때부터 검사한다', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        question={textQuestion({ inputType: 'mobile' })}
        initialValue="02-1234-5678"
        prior={{ q1: '02-1234-5678' }}
      />,
    );
    const input = screen.getByRole('textbox');

    await user.type(input, '9');
    await user.tab();
    expect(screen.getByText(/휴대전화 번호가 아닙니다/)).toBeInTheDocument();
  });
});
