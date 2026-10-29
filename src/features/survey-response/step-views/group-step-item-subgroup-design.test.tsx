import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupStepItem } from '@/features/survey-response/step-views/group-step-item';
import type { GroupNameDesign, Question } from '@/types/survey';
import type { StepItem } from '@/utils/group-ordering';

vi.mock('@/utils/branch-logic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/branch-logic')>()),
  shouldDisplayQuestion: () => true,
}));
vi.mock('@/hooks/use-media-query', () => ({ useMobileView: () => false, useMediaQuery: () => false }));

function renderHeading(design: GroupNameDesign | undefined) {
  const question = { id: 'q1', type: 'text', title: '3. 마케팅 비용', required: false, order: 1 } as Question;
  const item: StepItem = {
    question,
    rootGroupId: 'root',
    rootGroupName: null,
    subgroupName: '※ 다음은 마케팅 비용에 관한 질문입니다.',
    subgroupNameDesign: design,
  };
  render(
    <GroupStepItem
      item={item}
      showSubgroupHeading
      responses={{}}
      questions={[question]}
      onResponse={vi.fn()}
      isHighlighted={false}
      showRequiredMessage={false}
      showChangeConfirmMessage={false}
    />,
  );
  return screen.getByText('※ 다음은 마케팅 비용에 관한 질문입니다.');
}

describe('GroupStepItem 하위 그룹 소제목 디자인', () => {
  it('하위 그룹에 디자인이 있으면 루트 그룹 배지와 같은 얼굴로 그린다', () => {
    const heading = renderHeading({ fullWidth: true, bgColor: '#000000', textColor: '#ffffff' });
    expect(heading).toHaveStyle({ backgroundColor: '#000000', color: '#ffffff' });
    expect(heading.className).toContain('w-full');
    expect(heading.className).not.toContain('text-gray-500');
  });

  it('디자인이 없으면 종전대로 회색 소제목이다', () => {
    const heading = renderHeading(undefined);
    expect(heading.tagName).toBe('H3');
    expect(heading.className).toContain('text-gray-500');
  });

  it('디자인이 비어 있으면(기본값으로 되돌림) 회색 소제목이다', () => {
    expect(renderHeading({}).tagName).toBe('H3');
  });
});
