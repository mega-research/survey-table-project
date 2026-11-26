import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 이 테스트는 카드가 그려진 모양만 본다 — 저장 플로우와 테스트 표본 조회는 stub
vi.mock('@/features/survey-builder/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      testSample: {
        get: vi.fn().mockResolvedValue(null),
      },
    },
  },
}));

import { SortableQuestionList } from '@/features/survey-builder/question-list/sortable-question-list';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { useTestResponseStore } from '@/features/survey-builder/stores/test-response-store';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { Question } from '@/types/survey';

import {
  ariaReferenceIds,
  resolveAriaReferences,
} from '../../../../tests/helpers/aria-references';

/**
 * 빌더 미리보기 카드의 라디오 문항 — 척도 슬라이더 라디오 묶음의 낭독 이름(CONTEXT.md 「척도 슬라이더」).
 *
 * 카드 머리의 문항 제목 요소가 슬라이더 묶음의 이름이다(응답 화면과 같은 규칙). 카드 껍데기(제목)는 문항
 * 목록이, 슬라이더는 미리보기 본문이 그리므로 목록째로 그려 그 사이의 배선을 본다.
 */

const LABELS = ['전혀 없다', '없다', '보통이다', '있다', '매우 있다'];

const sliderQuestion = (id: string, title: string, extra: Partial<Question> = {}): Question =>
  ({
    id,
    type: 'radio',
    title,
    required: false,
    order: 0,
    scaleSlider: 'positive-right',
    options: LABELS.map((label, n) => ({ id: `${id}-o${n + 1}`, label, value: String(n + 1) })),
    ...extra,
  }) as unknown as Question;

function seedSurvey(questions: Question[]) {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions,
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

const sliderGroup = (questionId: string) =>
  within(screen.getByTestId(`scale-slider-${questionId}`)).getByRole('radiogroup');

describe('빌더 미리보기 카드 — 라디오 문항 척도 슬라이더의 이름', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    useTestResponseStore.getState().clearTestResponses();
    useSurveyResponseStore.getState().resetResponseState();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('카드 머리의 문항 제목 요소가 슬라이더 묶음의 이름이다', async () => {
    seedSurvey([sliderQuestion('q1', '추천 의향')]);
    render(<SortableQuestionList selectedQuestionId={null} />);
    await screen.findByTestId('scale-slider-q1');

    const group = sliderGroup('q1');
    const [title] = resolveAriaReferences(group, 'aria-labelledby');
    expect(ariaReferenceIds(group, 'aria-labelledby')).toHaveLength(1);
    expect(title).toBe(screen.getByRole('heading', { name: '추천 의향' }));
    expect(group).not.toHaveAttribute('aria-label');
    expect(group).not.toHaveAttribute('aria-describedby');
  });

  it('슬라이더 문항이 여럿이어도 저마다 제 카드의 제목을 가리킨다', async () => {
    seedSurvey([
      sliderQuestion('q1', '추천 의향'),
      sliderQuestion('q2', '재방문 의향', { order: 1 }),
    ]);
    render(<SortableQuestionList selectedQuestionId={null} />);
    await screen.findByTestId('scale-slider-q2');

    // 제목 id 가 겹치면 헬퍼가 던진다
    expect(resolveAriaReferences(sliderGroup('q1'), 'aria-labelledby')[0]).toHaveTextContent(
      '추천 의향',
    );
    expect(resolveAriaReferences(sliderGroup('q2'), 'aria-labelledby')[0]).toHaveTextContent(
      '재방문 의향',
    );
  });

  it('서식이 든 제목도 그 제목 요소가 이름이다', async () => {
    seedSurvey([
      sliderQuestion('q1', '추천 의향', {
        titleHtml: '<p><strong>추천</strong> 의향</p>',
      } as Partial<Question>),
    ]);
    render(<SortableQuestionList selectedQuestionId={null} />);
    await screen.findByTestId('scale-slider-q1');

    const [title] = resolveAriaReferences(sliderGroup('q1'), 'aria-labelledby');
    expect(title).toBe(screen.getByTestId('builder-question-title-rich'));
    expect(title).toHaveTextContent('추천 의향');
  });
});
