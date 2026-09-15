import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupStepItem } from '@/components/survey-response/step-views/group-step-item';
import type { StepItem } from '@/lib/group-ordering';
import type { Question } from '@/types/survey';

vi.mock('@/utils/branch-logic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/branch-logic')>()),
  shouldDisplayQuestion: () => true,
}));
// 모바일 — 축 단위 카드가 그려지는 조건
vi.mock('@/hooks/use-media-query', () => ({ useMobileView: () => true, useMediaQuery: () => true }));

/** A1 축소판: 활용 여부(cb1)·활용 계획(cb2) 체크박스 그룹, 모바일 축 단위 카드 */
function axisQuestion(): Question {
  return {
    id: 'q1',
    type: 'checkbox',
    title: 'A1',
    required: true,
    order: 1,
    mobileTableDisplayMode: 'axis-cards',
    choiceGroups: [
      { id: 'g1', type: 'checkbox', groupKey: 'cb1', label: '활용 여부' },
      { id: 'g2', type: 'checkbox', groupKey: 'cb2', label: '활용 계획' },
    ],
    tableColumns: [
      { id: 'c0', label: '제품' },
      { id: 'c1', label: '활용 여부' },
      { id: 'c2', label: '활용 계획' },
    ],
    tableRowsData: [
      {
        id: 'r1',
        cells: [
          { id: 'r1c0', type: 'text', content: '① 연산 및 제어' },
          { id: 'r1c1', type: 'choice_opt', content: '', choiceGroupId: 'g1' },
          { id: 'r1c2', type: 'choice_opt', content: '', choiceGroupId: 'g2' },
        ],
      },
    ],
  } as unknown as Question;
}

const toItem = (question: Question): StepItem => ({
  question,
  rootGroupId: null,
  rootGroupName: null,
  subgroupName: null,
});

describe('GroupStepItem — 모바일 축 단위 카드의 필수 안내', () => {
  it('검증 안내 상자는 미충족 카드 아래에만 있고 문항 아래에는 겹쳐 내지 않는다', () => {
    const question = axisQuestion();
    render(
      <GroupStepItem
        item={toItem(question)}
        showSubgroupHeading={false}
        responses={{ q1: { cb1: ['r1c1'] } }}
        questions={[question]}
        onResponse={vi.fn()}
        isHighlighted
        showRequiredMessage
        showChangeConfirmMessage={false}
      />,
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.previousElementSibling).toHaveAttribute('data-testid', 'axis-card-g2');
    expect(screen.getAllByRole('button', { name: '위치로 이동' })).toHaveLength(1);
    // 아래 한 줄 안내(<p>)도 없다 — 문구는 카드 머리와 상자가 맡는다
    expect(screen.getAllByText('필수 질문에 답변해주세요.')).toHaveLength(2);
  });
});
