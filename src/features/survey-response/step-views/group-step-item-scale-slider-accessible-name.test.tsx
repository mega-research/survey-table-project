import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PriorAnswersProvider } from '@/features/question-renderer/prior-answers-context';
import { GroupStepItem } from '@/features/survey-response/step-views/group-step-item';
import type { Question } from '@/types/survey';
import type { StepItem } from '@/utils/group-ordering';

import {
  ariaReferenceIds,
  resolveAriaReferences,
} from '../../../../tests/helpers/aria-references';

/**
 * 응답 화면의 보통 라디오 문항 — 척도 슬라이더 라디오 묶음의 낭독 이름(CONTEXT.md 「척도 슬라이더」).
 *
 * 문항 카드가 그리는 제목 요소가 슬라이더 묶음의 이름이다(글자를 따로 넘기지 않는다). 제목을 숨긴 문항은
 * 가리킬 요소가 없어 제목 글자가 이름이다. 보통 라디오 문항에는 필수 강조를 넘기지 않으므로 오류 문구는
 * 잇지 않는다. 문항 카드(제목을 그리는 자리)까지 이은 통합 테스트다.
 */

vi.mock('@/utils/branch-logic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/branch-logic')>()),
  shouldDisplayQuestion: () => true,
}));
vi.mock('@/hooks/use-media-query', () => ({ useMobileView: () => false, useMediaQuery: () => false }));

const LABELS = ['전혀 없다', '없다', '보통이다', '있다', '매우 있다'];

const radioQuestion = (extra: Partial<Question> = {}): Question =>
  ({
    id: 'q7',
    type: 'radio',
    title: '추천 의향',
    required: false,
    order: 1,
    scaleSlider: 'positive-right',
    options: LABELS.map((label, n) => ({ id: `o${n + 1}`, label, value: String(n + 1) })),
    ...extra,
  }) as unknown as Question;

const toItem = (question: Question): StepItem => ({
  question,
  rootGroupId: null,
  rootGroupName: null,
  subgroupName: null,
});

function renderItem(question: Question, showRequiredMessage = false) {
  render(
    <PriorAnswersProvider
      answers={null}
      confirmAnswers={null}
      highlightAnswers={null}
      waveLabel={null}
      changeConfirmEnabled={false}
    >
      <GroupStepItem
        item={toItem(question)}
        showSubgroupHeading={false}
        responses={{}}
        questions={[question]}
        onResponse={vi.fn()}
        isHighlighted={showRequiredMessage}
        showRequiredMessage={showRequiredMessage}
        showChangeConfirmMessage={false}
      />
    </PriorAnswersProvider>,
  );
  return within(screen.getByTestId('scale-slider-q7')).getByRole('radiogroup');
}

describe('응답 화면 라디오 문항의 척도 슬라이더 이름', () => {
  it('화면에 보이는 문항 제목 요소가 슬라이더 묶음의 이름이다', () => {
    const group = renderItem(radioQuestion());
    const [title] = resolveAriaReferences(group, 'aria-labelledby');
    expect(ariaReferenceIds(group, 'aria-labelledby')).toHaveLength(1);
    expect(title).toHaveTextContent('추천 의향');
    expect(title).toBe(screen.getByText('추천 의향'));
    expect(group).not.toHaveAttribute('aria-label');
    expect(screen.getByRole('radiogroup', { name: '추천 의향' })).toBe(group);
  });

  it('문항 영역과 슬라이더 묶음이 같은 제목 요소를 가리킨다', () => {
    const group = renderItem(radioQuestion());
    const region = group.closest('[role="group"]')!;
    expect(region.getAttribute('aria-labelledby')).toBe(group.getAttribute('aria-labelledby'));
  });

  it('서식이 든 제목도 그 제목 요소가 이름이다', () => {
    const group = renderItem(
      radioQuestion({ titleHtml: '<p><strong>추천</strong> 의향</p>' } as Partial<Question>),
    );
    const [title] = resolveAriaReferences(group, 'aria-labelledby');
    expect(title).toHaveTextContent('추천 의향');
    expect(group).not.toHaveAttribute('aria-label');
  });

  it('제목을 숨긴 문항은 가리킬 요소가 없어 제목 글자가 이름이다', () => {
    const group = renderItem(radioQuestion({ hideTitle: true }));
    expect(group).not.toHaveAttribute('aria-labelledby');
    expect(group).toHaveAttribute('aria-label', '추천 의향');
  });

  it('필수 미응답 안내가 떠도 슬라이더에는 오류 문구를 잇지 않는다', () => {
    const group = renderItem(radioQuestion({ required: true }), true);
    expect(group).not.toHaveAttribute('aria-describedby');
    expect(group).not.toHaveAttribute('aria-invalid');
    // 이름은 그대로 제목 요소다
    expect(resolveAriaReferences(group, 'aria-labelledby')).toHaveLength(1);
  });
});
