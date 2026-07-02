import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuotaEditor } from '@/components/operations/quota/quota-editor';
import type { QuotaConfig } from '@/db/schema/schema-types';
import type { Question } from '@/types/survey';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    quota: {
      save: vi.fn(),
    },
  },
}));

const genderQuestion: Question = {
  id: 'q-gender',
  type: 'radio',
  title: '성별',
  required: false,
  order: 1,
  options: [
    { id: 'opt-male', label: '남성', value: 'male' },
    { id: 'opt-female', label: '여성', value: 'female' },
  ],
};

const ageQuestion: Question = {
  id: 'q-age',
  type: 'text',
  title: '나이',
  required: false,
  order: 2,
  inputType: 'number',
};

const config: QuotaConfig = {
  enabled: false,
  dimensions: [
    {
      id: 'dim-gender',
      questionId: genderQuestion.id,
      label: genderQuestion.title,
      kind: 'choice',
      categories: [
        { id: 'cat-male', label: '남성', values: ['male'] },
        { id: 'cat-female', label: '여성', values: ['female'] },
      ],
    },
  ],
  cells: [],
  closedMessage: null,
};

describe('QuotaEditor', () => {
  it('쿼터 조건 편집 문구를 쉬운 표현으로 표시한다', () => {
    render(
      <QuotaEditor
        surveyId="survey-1"
        initialConfig={config}
        questions={[genderQuestion, ageQuestion]}
      />,
    );

    expect(screen.getByRole('heading', { name: '조건' })).toBeInTheDocument();
    expect(screen.getByText('조건 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '조건 삭제' })).toBeInTheDocument();
    expect(screen.getByText('+ 조건 추가')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '조건 보기' })).toBeInTheDocument();

    expect(screen.queryByText('차원')).not.toBeInTheDocument();
    expect(screen.queryByText('+ 차원 추가')).not.toBeInTheDocument();
    expect(screen.queryByText('쿼터 셀 · 목표 입력')).not.toBeInTheDocument();
  });

  it('선택형 조건의 보기를 표 대신 줄바꿈되는 변수 목록으로 표시한다', () => {
    render(
      <QuotaEditor
        surveyId="survey-1"
        initialConfig={config}
        questions={[genderQuestion, ageQuestion]}
      />,
    );

    const optionList = screen.getByRole('list', { name: '성별 변수 목록' });

    expect(optionList).toHaveClass('flex', 'flex-wrap');
    expect(within(optionList).getAllByRole('listitem')).toHaveLength(2);
    expect(within(optionList).getByText('남성')).toBeInTheDocument();
    expect(within(optionList).getByText('여성')).toBeInTheDocument();
    expect(screen.queryByText('보기가 자동으로 등록됩니다 (읽기 전용).')).not.toBeInTheDocument();
  });
});
