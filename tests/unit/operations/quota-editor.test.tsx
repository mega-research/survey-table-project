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

const platformQuestion: Question = {
  id: 'q-platform',
  type: 'checkbox',
  title: '플랫폼 유형',
  required: false,
  order: 3,
  options: [
    { id: 'opt-mobile', label: '모바일', value: 'mobile' },
    { id: 'opt-pc', label: 'PC', value: 'pc' },
  ],
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

  it('checkbox 문항도 조건 후보로 허용한다 — 후보 없음 안내가 뜨지 않는다', () => {
    render(
      <QuotaEditor
        surveyId="survey-1"
        initialConfig={null}
        questions={[platformQuestion]}
      />,
    );

    expect(screen.queryByText(/추가할 수 있는 문항이 없습니다/)).not.toBeInTheDocument();
  });

  it('checkbox 조건에는 복수 선택 분류 안내를 표시한다', () => {
    const checkboxConfig: QuotaConfig = {
      enabled: false,
      dimensions: [
        {
          id: 'dim-platform',
          questionId: platformQuestion.id,
          label: platformQuestion.title,
          kind: 'choice',
          categories: [
            { id: 'cat-mobile', label: '모바일', values: ['mobile'] },
            { id: 'cat-pc', label: 'PC', values: ['pc'] },
          ],
        },
      ],
      cells: [],
      closedMessage: null,
    };

    render(
      <QuotaEditor
        surveyId="survey-1"
        initialConfig={checkboxConfig}
        questions={[platformQuestion]}
      />,
    );

    expect(screen.getByText('복수 선택 → 먼저 매칭되는 카테고리 1개로 분류')).toBeInTheDocument();
  });
});
