import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Question } from '@/types/survey';

import { SpssVariableManager } from '@/components/survey-builder/spss-variable-manager';

function makeQuestion(
  overrides: Partial<Question> & { type: Question['type']; order: number },
): Question {
  return {
    id: `q-${overrides.order}`,
    title: `문제${overrides.order}`,
    required: false,
    ...overrides,
  } as Question;
}

const sampleQuestions: Question[] = [
  makeQuestion({
    type: 'radio',
    order: 1,
    questionCode: 'Q1',
    title: '성별',
    options: [
      { id: 'o1', label: '남성', value: 'o1', spssNumericCode: 1 },
      { id: 'o2', label: '여성', value: 'o2', spssNumericCode: 2 },
    ],
  }),
  makeQuestion({
    type: 'checkbox',
    order: 2,
    questionCode: 'Q2',
    title: '품목',
    options: [
      { id: 'o1', label: 'A', value: 'o1', spssNumericCode: 1 },
      { id: 'o2', label: 'B', value: 'o2', spssNumericCode: 2 },
    ],
  }),
  makeQuestion({
    type: 'text',
    order: 3,
    questionCode: 'Q3',
    title: '의견',
  }),
];

describe('SpssVariableManager', () => {
  const defaultProps = {
    questions: sampleQuestions,
    onRegenerate: vi.fn(),
    onValidate: vi.fn(),
  };

  it('모든 질문의 변수명 목록을 렌더링한다', () => {
    render(<SpssVariableManager {...defaultProps} />);
    expect(screen.getByText('Q1')).toBeInTheDocument();
    expect(screen.getByText('Q2')).toBeInTheDocument();
    expect(screen.getByText('Q3')).toBeInTheDocument();
  });

  it('질문 제목을 표시한다', () => {
    render(<SpssVariableManager {...defaultProps} />);
    expect(screen.getByText('성별')).toBeInTheDocument();
    expect(screen.getByText('품목')).toBeInTheDocument();
    expect(screen.getByText('의견')).toBeInTheDocument();
  });

  it('질문 타입을 표시한다', () => {
    render(<SpssVariableManager {...defaultProps} />);
    expect(screen.getByText('radio')).toBeInTheDocument();
    expect(screen.getByText('checkbox')).toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('checkbox 질문의 하위 변수를 표시한다', () => {
    render(<SpssVariableManager {...defaultProps} />);
    expect(screen.getByText('Q2_1~Q2_2')).toBeInTheDocument();
  });

  it('자동 재할당 버튼을 렌더링한다', () => {
    render(<SpssVariableManager {...defaultProps} />);
    expect(screen.getByRole('button', { name: /자동 재할당/i })).toBeInTheDocument();
  });

  it('검증 버튼을 렌더링한다', () => {
    render(<SpssVariableManager {...defaultProps} />);
    expect(screen.getByRole('button', { name: /검증/i })).toBeInTheDocument();
  });

  it('자동 재할당 버튼 클릭 시 onRegenerate가 호출된다', async () => {
    const onRegenerate = vi.fn();
    render(<SpssVariableManager {...defaultProps} onRegenerate={onRegenerate} />);

    await userEvent.click(screen.getByRole('button', { name: /자동 재할당/i }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it('검증 버튼 클릭 시 onValidate가 호출된다', async () => {
    const onValidate = vi.fn();
    render(<SpssVariableManager {...defaultProps} onValidate={onValidate} />);

    await userEvent.click(screen.getByRole('button', { name: /검증/i }));
    expect(onValidate).toHaveBeenCalledOnce();
  });

  it('notice 질문은 표시하지 않는다', () => {
    const questions = [
      ...sampleQuestions,
      makeQuestion({ type: 'notice', order: 4, title: '안내문' }),
    ];
    render(<SpssVariableManager {...defaultProps} questions={questions} />);
    expect(screen.queryByText('안내문')).not.toBeInTheDocument();
  });

  it('검증 오류를 표시한다', () => {
    const errors = [
      { code: 'DUPLICATE' as const, message: "변수명 'Q1'이(가) 중복됩니다." },
    ];
    render(<SpssVariableManager {...defaultProps} validationErrors={errors} />);
    expect(screen.getByText(/중복/)).toBeInTheDocument();
  });
});
