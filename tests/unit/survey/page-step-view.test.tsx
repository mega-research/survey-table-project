import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageStepView } from '@/components/survey-response/step-views/page-step-view';
import type { RenderStep } from '@/lib/group-ordering';

// GroupStepItem 내부(useContactAttrs/QuestionInput)를 끌어오지 않도록 항목 렌더러를 목으로 대체.
// 이 테스트의 관심사는 PageStepView의 그룹 헤더 전환 로직 + 항목 위임이다.
vi.mock('@/components/survey-response/step-views/group-step-item', () => ({
  GroupStepItem: ({ item }: { item: { question: { id: string } } }) => (
    <div data-testid={`qi-${item.question.id}`} />
  ),
}));

// shouldDisplayQuestion이 evalCtx 없이도 true를 반환하도록 단순화.
vi.mock('@/utils/branch-logic', () => ({
  shouldDisplayQuestion: () => true,
}));

const step: RenderStep = {
  kind: 'page',
  items: [
    { question: { id: 'q1', type: 'radio', title: 'Q1', required: false, order: 0 } as never,
      rootGroupId: 'g1', rootGroupName: '기본정보', subgroupName: null },
    { question: { id: 'q2', type: 'radio', title: 'Q2', required: false, order: 1 } as never,
      rootGroupId: 'g2', rootGroupName: 'TV시청', subgroupName: null },
  ],
};

describe('PageStepView', () => {
  it('페이지가 그룹을 가로지르면 두 그룹 헤더를 모두 렌더한다', () => {
    render(
      <PageStepView
        step={step}
        responses={{}}
        questions={step.items.map((i) => i.question)}
        groups={[]}
        evalCtx={undefined as never}
        onResponse={() => {}}
        highlightQuestionIds={new Set()}
        numericIssues={new Map()}
      />,
    );
    expect(screen.getByText('기본정보')).toBeInTheDocument();
    expect(screen.getByText('TV시청')).toBeInTheDocument();
    expect(screen.getByTestId('qi-q1')).toBeInTheDocument();
    expect(screen.getByTestId('qi-q2')).toBeInTheDocument();
  });

  it('문항 래퍼가 divide-y 직계 형제로 py 여백을 소유한다 (중간 문항 간격 회귀 가드)', () => {
    const { container } = render(
      <PageStepView
        step={step}
        responses={{}}
        questions={step.items.map((i) => i.question)}
        groups={[]}
        evalCtx={undefined as never}
        onResponse={() => {}}
        highlightQuestionIds={new Set()}
        numericIssues={new Map()}
      />,
    );
    // 여백 클래스는 divide-y 컨테이너의 직계 자식(래퍼)에 있어야 first:/last:가
    // 페이지 내 실제 첫/마지막 문항에만 적용된다. GroupStepItem 내부에 두면
    // 항목마다 유일한 자식이 되어 py가 전부 0으로 죽는다.
    const wrappers = container.querySelectorAll('.divide-y > div');
    expect(wrappers.length).toBe(2);
    wrappers.forEach((w) => {
      expect(w.className).toContain('py-5');
      expect(w.className).toContain('first:pt-0');
      expect(w.className).toContain('last:pb-0');
    });
  });
});
