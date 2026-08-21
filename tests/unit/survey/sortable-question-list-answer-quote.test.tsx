/**
 * Task 9 — 빌더 편집 목록(SortableQuestionList)의 카드 미리보기에도 응답 인용이
 * 배선되는지 확인하는 회귀 테스트.
 *
 * 이전에는 ContactAttrsProvider 에 `attrs` 만 넘기고 `quotes` 는 넘기지 않아,
 * 빌더 카드 미리보기에서 인용 토큰이 항상 빈칸으로만 보였다 (실제로 오타인지,
 * 아직 응답을 안 골라서인지 구분 불가). collectAnswerQuotes 를 응답 페이지와
 * 동일하게 태워 계산하고, createPlaceholderAttrs 로 감싸 미정의 이름을
 * `[키]` 로 가시화하는 오타 진단까지 살아있는지 검증한다.
 *
 * Fix round 1 — 리뷰가 지적한 사실: quotes 배선만으로는 부족했다. 카드 헤더
 * 제목(`sortable-question-list.tsx` h4)이 토큰을 전혀 치환하지 않아, 이 기능의
 * 가장 흔한 용례("응답에 따라 뒤 질문 제목이 바뀐다")를 빌더에서 검증할 방법이
 * 여전히 없었다. 아래 테스트는 옵션 라벨(기존 소비처)과 질문 제목(신규 소비처)을
 * 함께 검증한다.
 *
 * Fix round 2 — 제목 바로 아래의 질문 설명(`question.description`, sanitizeRichHtml
 * 로만 렌더)도 동일한 비대칭이었다. substitute 후 sanitize 순서(sanitize(substitute(x)))
 * 로 고쳤고, 아래 테스트에 설명 소비처를 추가한다.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 옵션 value 리매핑이 있을 때만 호출되는 설문 저장 플로우 — 이 테스트는 렌더/저장 경로만 보므로 stub.
vi.mock('@/components/survey-builder/hooks/use-survey-sync', () => ({
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

import { SortableQuestionList } from '@/components/survey-builder/question-list/sortable-question-list';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { Question } from '@/types/survey';

function radioQuoteQuestion(): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '마케팅 유형을 고르세요',
    required: false,
    order: 0,
    answerQuoteEnabled: true,
    answerQuoteName: '마케팅유형',
    options: [
      { id: 'o1', value: 'v1', label: '뉴스레터', answerQuoteText: '뉴스레터를' },
      { id: 'o2', value: 'v2', label: '문자', answerQuoteText: '문자를' },
    ],
  } as unknown as Question;
}

function consumingMultiselectQuestion(templateName: string): Question {
  return {
    id: 'q2',
    type: 'multiselect',
    title: '레벨선택 질문',
    required: false,
    order: 1,
    selectLevels: [
      {
        id: 'lv1',
        label: '레벨',
        order: 0,
        options: [{ id: 'lo1', value: 'lo1', label: `{{{${templateName}}}} 신청` }],
      },
    ],
  } as unknown as Question;
}

/** 카드 헤더 제목(h4) 소비처 검증용 — 제목 자체에 인용 토큰을 심는다. */
function titleConsumingQuestion(templateName: string): Question {
  return {
    id: 'q3',
    type: 'text',
    title: `{{{${templateName}}}} 안내`,
    required: false,
    order: 2,
  } as unknown as Question;
}

/** 질문 설명(question.description) 소비처 검증용 — sanitizeRichHtml 로만 렌더되던 지점. */
function descriptionConsumingQuestion(templateName: string): Question {
  return {
    id: 'q4',
    type: 'text',
    title: '설명 소비 질문',
    description: `<p>설명시작${'{{{' + templateName + '}}}'}설명끝</p>`,
    required: false,
    order: 3,
  } as unknown as Question;
}

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

describe('SortableQuestionList — 빌더 테스트 모드 응답 인용 배선', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    useTestResponseStore.getState().clearTestResponses();
    useSurveyResponseStore.getState().resetResponseState();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('아직 아무것도 선택하지 않으면 인용 이름이 존재해도 빈칸으로 렌더된다', async () => {
    seedSurvey([
      radioQuoteQuestion(),
      consumingMultiselectQuestion('마케팅유형'),
      titleConsumingQuestion('마케팅유형'),
      descriptionConsumingQuestion('마케팅유형'),
    ]);

    render(<SortableQuestionList selectedQuestionId={null} />);

    const option = await screen.findByRole('option', { name: '신청' });
    expect(option).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '[마케팅유형] 신청' })).not.toBeInTheDocument();

    // 카드 헤더 제목 — 옵션 라벨과 같은 quotes 채널을 타므로 동일하게 빈칸이어야 한다.
    expect(await screen.findByRole('heading', { level: 4, name: '안내' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 4, name: '[마케팅유형] 안내' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 4, name: '{{{마케팅유형}}} 안내' }),
    ).not.toBeInTheDocument();

    // 질문 설명 — sanitizeRichHtml 로만 렌더되던 지점도 같은 채널을 타 빈칸이어야 한다.
    expect(await screen.findByText('설명시작설명끝')).toBeInTheDocument();
    expect(screen.queryByText('설명시작[마케팅유형]설명끝')).not.toBeInTheDocument();
    expect(screen.queryByText(/\{\{\{마케팅유형\}\}\}/)).not.toBeInTheDocument();
  });

  it('앞 질문에서 옵션을 고르면 인용 문구로 바뀐다', async () => {
    seedSurvey([
      radioQuoteQuestion(),
      consumingMultiselectQuestion('마케팅유형'),
      titleConsumingQuestion('마케팅유형'),
      descriptionConsumingQuestion('마케팅유형'),
    ]);

    render(<SortableQuestionList selectedQuestionId={null} />);

    const radio = await screen.findByLabelText('뉴스레터');
    fireEvent.click(radio);

    expect(await screen.findByRole('option', { name: '뉴스레터를 신청' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '신청' })).not.toBeInTheDocument();

    // 카드 헤더 제목도 같은 응답으로 문구가 채워져야 한다 — 이게 이 기능의 핵심 용례다.
    expect(
      await screen.findByRole('heading', { level: 4, name: '뉴스레터를 안내' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 4, name: '안내' })).not.toBeInTheDocument();

    // 질문 설명도 같은 응답으로 문구가 채워져야 한다.
    expect(await screen.findByText('설명시작뉴스레터를설명끝')).toBeInTheDocument();
    expect(screen.queryByText('설명시작설명끝')).not.toBeInTheDocument();
  });

  it('소비처 질문이 존재하지 않는 인용 이름을 참조하면 [이름] 으로 오타가 드러난다', async () => {
    seedSurvey([
      radioQuoteQuestion(),
      consumingMultiselectQuestion('마케팅유형오타'),
      titleConsumingQuestion('마케팅유형오타'),
      descriptionConsumingQuestion('마케팅유형오타'),
    ]);

    render(<SortableQuestionList selectedQuestionId={null} />);

    expect(
      await screen.findByRole('option', { name: '[마케팅유형오타] 신청' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 4, name: '[마케팅유형오타] 안내' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('설명시작[마케팅유형오타]설명끝')).toBeInTheDocument();
  });
});
