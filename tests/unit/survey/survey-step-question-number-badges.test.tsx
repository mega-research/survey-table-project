import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupStepItem } from '@/components/survey-response/step-views/group-step-item';
import { GroupStepView } from '@/components/survey-response/step-views/group-step-view';
import { TableStepView } from '@/components/survey-response/step-views/table-step-view';
import type { RenderStep, StepItem } from '@/lib/group-ordering';
import type { Question, QuestionGroup } from '@/types/survey';

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

describe('survey response step headings', () => {
  it('그룹형 질문 제목 앞에 번호 원형 배지를 렌더하지 않는다', () => {
    const question = textQuestion();
    const item: StepItem = { question, subgroupName: null };

    render(
      <GroupStepItem
        item={item}
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

  it('모바일 그룹 카드처럼 여러 질문이 한 step에 있어도 번호 원형 배지를 렌더하지 않는다', () => {
    const questions = [
      textQuestion({ id: 'q4', title: '평소에 본인의 건강은 어떻다고 생각하십니까?', order: 4, groupId: 'g1' }),
      textQuestion({ id: 'q5', title: '현재 담배를 피우십니까?', order: 5, groupId: 'g1' }),
      textQuestion({ id: 'q6', title: '최근 1년 동안 술을 마신 적이 있습니까?', order: 6, groupId: 'g1' }),
    ];
    const groups = [
      { id: 'g1', surveyId: 'survey-1', name: 'II. 건강 상태', order: 0 },
    ] as QuestionGroup[];
    const step: Extract<RenderStep, { kind: 'group' }> = {
      kind: 'group',
      rootGroupId: 'g1',
      rootGroupName: 'II. 건강 상태',
      items: questions.map((question) => ({ question, subgroupName: null })),
    };

    const { container } = render(
      <GroupStepView
        step={step}
        responses={{}}
        questions={questions}
        groups={groups}
        evalCtx={{ responses: {}, contactAttrs: {}, lookups: [] }}
        onResponse={vi.fn()}
        highlightQuestionIds={new Set()}
      />,
    );

    expect(screen.getByText('평소에 본인의 건강은 어떻다고 생각하십니까?')).toBeInTheDocument();
    expect(screen.getByText('현재 담배를 피우십니까?')).toBeInTheDocument();
    expect(screen.getByText('최근 1년 동안 술을 마신 적이 있습니까?')).toBeInTheDocument();
    expect(container.querySelector('.rounded-full.bg-blue-100.text-blue-600')).toBeNull();
  });

  it('데스크톱 테이블형 질문 제목 앞에 번호 원형 배지를 렌더하지 않는다', () => {
    const question = textQuestion({ id: 'table-q', title: '이용 의향 표 질문' });
    const step: Extract<RenderStep, { kind: 'table' }> = {
      kind: 'table',
      rootGroupId: null,
      rootGroupName: null,
      subgroupName: null,
      question,
    };

    render(
      <TableStepView
        step={step}
        isMobile={false}
        responses={{}}
        questions={[question]}
        onResponse={vi.fn()}
        highlightQuestionIds={new Set()}
      />,
    );

    expect(screen.getByText('이용 의향 표 질문')).toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });
});
