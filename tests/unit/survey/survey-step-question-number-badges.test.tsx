import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupStepItem } from '@/components/survey-response/step-views/group-step-item';
import { PageStepView } from '@/components/survey-response/step-views/page-step-view';
import type { RenderStep, StepItem } from '@/lib/group-ordering';
import type { Question } from '@/types/survey';

// PageStepView가 evalCtx 없이도 모든 항목을 표시하도록 한다.
vi.mock('@/utils/branch-logic', () => ({ shouldDisplayQuestion: () => true }));

function textQuestion(partial: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'text',
    title: '증상 발생 시 이용할 의료기관',
    required: false,
    order: 1,
    ...partial,
  } as Question;
}

const toItem = (question: Question, rootGroupName: string | null = null): StepItem => ({
  question,
  rootGroupId: question.groupId ?? null,
  rootGroupName,
  subgroupName: null,
});

describe('survey response step headings', () => {
  it('그룹형 질문 제목 앞에 번호 원형 배지를 렌더하지 않는다', () => {
    const question = textQuestion();
    render(
      <GroupStepItem
        item={toItem(question)}
        showSubgroupHeading={false}
        responses={{}}
        questions={[question]}
        onResponse={vi.fn()}
        isHighlighted={false}
      />,
    );
    expect(screen.getByText('증상 발생 시 이용할 의료기관')).toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('여러 질문이 한 페이지에 있어도 번호 원형 배지를 렌더하지 않는다', () => {
    const questions = [
      textQuestion({ id: 'q4', title: '평소에 본인의 건강은 어떻다고 생각하십니까?', order: 4, groupId: 'g1' }),
      textQuestion({ id: 'q5', title: '현재 담배를 피우십니까?', order: 5, groupId: 'g1' }),
      textQuestion({ id: 'q6', title: '최근 1년 동안 술을 마신 적이 있습니까?', order: 6, groupId: 'g1' }),
    ];
    const step: RenderStep = {
      kind: 'page',
      items: questions.map((q) => toItem(q, 'II. 건강 상태')),
    };
    render(
      <PageStepView
        step={step}
        responses={{}}
        questions={questions}
        groups={[]}
        evalCtx={undefined as never}
        onResponse={vi.fn()}
        highlightQuestionIds={new Set()}
        numericIssues={new Map()}
      />,
    );
    expect(screen.getByText('현재 담배를 피우십니까?')).toBeInTheDocument();
    expect(screen.getByText('최근 1년 동안 술을 마신 적이 있습니까?')).toBeInTheDocument();
    // 빌더 전용 질문 번호 배지(4/5/6)가 응답 페이지에 새지 않는다.
    expect(screen.queryByText('4')).not.toBeInTheDocument();
    expect(screen.queryByText('5')).not.toBeInTheDocument();
    expect(screen.queryByText('6')).not.toBeInTheDocument();
  });
});
