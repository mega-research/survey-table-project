import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupStepItem } from '@/features/survey-response/step-views/group-step-item';
import type { Question } from '@/types/survey';
import type { StepItem } from '@/utils/group-ordering';

vi.mock('@/utils/branch-logic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/branch-logic')>()),
  shouldDisplayQuestion: () => true,
}));
vi.mock('@/hooks/use-media-query', () => ({ useMobileView: () => false, useMediaQuery: () => false }));

function renderTitle(partial: Partial<Question>) {
  const question = {
    id: 'q1',
    type: 'text',
    title: 'A4. 공급처',
    required: true,
    order: 1,
    ...partial,
  } as Question;
  const item: StepItem = { question, rootGroupId: null, rootGroupName: null, subgroupName: null };
  return render(
    <GroupStepItem
      item={item}
      showSubgroupHeading={false}
      responses={{}}
      questions={[question]}
      onResponse={vi.fn()}
      isHighlighted={false}
      showRequiredMessage={false}
      showChangeConfirmMessage={false}
    />,
  );
}

describe('GroupStepItem 제목 서식', () => {
  it('서식본이 있으면 굵게·밑줄·색·크기를 그리고 필수 표시는 같은 줄에 남는다', () => {
    renderTitle({
      titleHtml:
        '<p>A4. <strong>공급</strong><u>처</u><span style="color: #ff0000; font-size: 24px">!</span></p>',
      title: 'A4. 공급처!',
    });
    const rich = screen.getByTestId('question-title-rich');
    expect(rich.querySelector('strong')).toHaveTextContent('공급');
    expect(rich.querySelector('u')).toHaveTextContent('처');
    const span = rich.querySelector('span') as HTMLSpanElement;
    expect(span.style.color).toBe('rgb(255, 0, 0)');
    expect(span.style.fontSize).toBe('24px');
    expect(screen.getByLabelText('필수 질문')).toBeInTheDocument();
  });

  it('서식본이 없으면 평문 제목 그대로다', () => {
    renderTitle({});
    expect(screen.queryByTestId('question-title-rich')).toBeNull();
    expect(screen.getByText('A4. 공급처')).toBeInTheDocument();
  });

  it('평문과 어긋난 옛 서식본은 무시하고 평문을 그린다', () => {
    renderTitle({ titleHtml: '<p><strong>옛 제목</strong></p>' });
    expect(screen.queryByTestId('question-title-rich')).toBeNull();
    expect(screen.queryByText('옛 제목')).toBeNull();
    expect(screen.getByText('A4. 공급처')).toBeInTheDocument();
  });

  it('스크립트·허용 밖 태그는 걸러진다', () => {
    renderTitle({
      title: 'A4. 공급처',
      titleHtml: '<p>A4. <strong>공급처</strong><img src=x onerror="alert(1)"></p>',
    });
    expect(screen.getByTestId('question-title-rich').querySelector('img')).toBeNull();
  });
});
