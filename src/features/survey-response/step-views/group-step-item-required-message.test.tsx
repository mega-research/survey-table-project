import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupStepItem } from '@/features/survey-response/step-views/group-step-item';
import type { StepItem } from '@/utils/group-ordering';
import type { Question } from '@/types/survey';
import {
  DEFAULT_REQUIRED_MESSAGE,
  resolveRequiredMessage,
} from '@/utils/required-message';

vi.mock('@/utils/branch-logic', () => ({ shouldDisplayQuestion: () => true }));

function textQuestion(partial: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'text',
    title: '이름을 입력해 주세요',
    required: true,
    order: 1,
    ...partial,
  } as Question;
}

const toItem = (question: Question): StepItem => ({
  question,
  rootGroupId: null,
  rootGroupName: null,
  subgroupName: null,
});

function renderItem(question: Question, showRequiredMessage: boolean) {
  return render(
    <GroupStepItem
      item={toItem(question)}
      showSubgroupHeading={false}
      responses={{}}
      questions={[question]}
      onResponse={vi.fn()}
      isHighlighted={showRequiredMessage}
      showRequiredMessage={showRequiredMessage}
    />,
  );
}

describe('resolveRequiredMessage', () => {
  it('사용자 지정 문구가 있으면 그대로 반환한다', () => {
    expect(resolveRequiredMessage({ requiredMessage: '연락처는 꼭 남겨주세요' })).toBe(
      '연락처는 꼭 남겨주세요',
    );
  });

  it('미입력·공백뿐이면 기본 문구로 폴백한다', () => {
    expect(resolveRequiredMessage({ requiredMessage: null })).toBe(DEFAULT_REQUIRED_MESSAGE);
    expect(resolveRequiredMessage({})).toBe(DEFAULT_REQUIRED_MESSAGE);
    expect(resolveRequiredMessage({ requiredMessage: '   ' })).toBe(DEFAULT_REQUIRED_MESSAGE);
  });
});

describe('GroupStepItem 필수 안내 문구', () => {
  it('showRequiredMessage=true 이고 지정 문구가 있으면 그 문구를 표시한다', () => {
    renderItem(textQuestion({ requiredMessage: '연락처는 꼭 남겨주세요' }), true);
    expect(screen.getByText('연락처는 꼭 남겨주세요')).toBeInTheDocument();
  });

  it('지정 문구가 없으면 기본 문구를 표시한다', () => {
    renderItem(textQuestion(), true);
    expect(screen.getByText(DEFAULT_REQUIRED_MESSAGE)).toBeInTheDocument();
  });

  it('showRequiredMessage=false 이면 문구를 렌더하지 않는다', () => {
    renderItem(textQuestion({ requiredMessage: '연락처는 꼭 남겨주세요' }), false);
    expect(screen.queryByText('연락처는 꼭 남겨주세요')).not.toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_REQUIRED_MESSAGE)).not.toBeInTheDocument();
  });
});
