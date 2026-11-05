import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PageStepView } from '@/features/survey-response/step-views/page-step-view';
import type { Question } from '@/types/survey';
import type { RenderStep } from '@/utils/group-ordering';

/** 앞 문항 설명 밑에 붙이기 — 실제 GroupStepItem 으로 자리를 확인한다 */
vi.mock('@/utils/branch-logic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/branch-logic')>()),
  shouldDisplayQuestion: () => true,
}));
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => false,
  useMediaQuery: () => false,
}));

const q1 = {
  id: 'q1',
  type: 'text',
  title: '문1. 생산 현황',
  description: '<p>제품 품목을 선택하고</p>',
  required: false,
  order: 0,
} as Question;
const ref = {
  id: 'ref',
  type: 'text',
  title: '코드표 본문',
  required: false,
  order: 1,
  collapseButtonLabel: '[붙임] 제품 품목 코드표',
  collapseAttachToPrevious: true,
} as Question;
const step: RenderStep = {
  kind: 'page',
  items: [q1, ref].map((question) => ({
    question,
    rootGroupId: null,
    rootGroupName: null,
    subgroupName: null,
  })),
};

describe('앞 문항 설명 밑에 붙이기', () => {
  it('붙임 버튼이 앞 문항 설명과 입력 사이에 들어가고, 누르면 그 자리에서 펼쳐진다', () => {
    const { container } = render(
      <PageStepView
        step={step}
        responses={{}}
        questions={[q1, ref]}
        groups={[]}
        evalCtx={undefined as never}
        onResponse={() => {}}
        highlightQuestionIds={new Set()}
        requiredMessageQuestionIds={new Set()}
        changeConfirmMessageQuestionIds={new Set<string>()}
        numericIssues={new Map()}
      />,
    );
    // 페이지 줄은 하나 — 붙인 문항은 제자리에 따로 서지 않는다
    expect(container.querySelectorAll('.divide-y > div')).toHaveLength(1);
    const host = container.querySelector('[data-question-id="q1"]') as HTMLElement;
    const button = within(host).getByRole('button', { name: /^\[붙임\] 제품 품목 코드표/ });
    const description = within(host).getByText('제품 품목을 선택하고');
    const input = within(host).getByRole('group', { name: '문1. 생산 현황' });
    // 문서 순서: 설명 → 붙임 버튼 → 문1 입력
    expect(
      description.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(button.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByText('코드표 본문')).not.toBeVisible();
    fireEvent.click(button);
    expect(screen.getByText('코드표 본문')).toBeVisible();
  });
});
