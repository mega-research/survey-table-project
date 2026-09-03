import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question, QuestionGroup, Survey } from '@/types/survey';

/**
 * 필수 게이트 피드백 (티켓 14).
 *
 * - 하단 안내(데스크톱 「* 필수 질문에 답변해주세요」, 모바일 「필수 질문」)는 그 페이지에서
 *   「다음」을 시도해 막힌 뒤부터만 뜬다. 답을 다 채우면 즉시 사라지고, 페이지를 옮기면
 *   뜨지 않으며, 돌아와도 다시 시도하기 전엔 뜨지 않는다.
 * - 막혔을 때 그 페이지의 미답 필수 문항 **전부**가 강조되고 문항별 문구도 전부 뜬다.
 *   답한 문항의 강조·문구만 즉시 풀린다.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// 조사표 판(PDF.js)은 jsdom 에서 열 수 없다 — 오른쪽 체크리스트만 보는 테스트라 빈 판으로 대체.
vi.mock('@/components/survey-document/response-document-pane', () => ({
  ResponseDocumentPane: () => <div data-testid="document-pane" />,
}));

const BOTTOM_NOTICE = '* 필수 질문에 답변해주세요';
const PER_QUESTION_MESSAGE = '필수 질문에 답변해주세요.';
const MOBILE_NOTICE = '필수 질문';

/** 1쪽 선택 문항 / 2쪽 필수 radio 둘 / 3쪽 마무리 문항. */
const questions: Question[] = [
  {
    id: 'q-intro',
    type: 'text',
    title: '안내 질문',
    description: '',
    required: false,
    order: 0,
  },
  {
    id: 'q-a',
    type: 'radio',
    title: '첫 번째 필수 질문',
    description: '',
    required: true,
    order: 1,
    pageBreakBefore: true,
    options: [
      { id: 'a-yes', value: 'yes', label: '예' },
      { id: 'a-no', value: 'no', label: '아니오' },
    ],
  },
  {
    id: 'q-b',
    type: 'radio',
    title: '두 번째 필수 질문',
    description: '',
    required: true,
    order: 2,
    options: [
      { id: 'b-yes', value: 'yes', label: '동의' },
      { id: 'b-no', value: 'no', label: '비동의' },
    ],
  },
  {
    id: 'q-last',
    type: 'text',
    title: '마무리 질문',
    description: '',
    required: false,
    order: 3,
    pageBreakBefore: true,
  },
] as Question[];

function createSurvey(overrides: Partial<Survey> = {}): Survey {
  return {
    id: 'survey-required-gate',
    title: '필수 게이트 설문',
    status: 'published',
    currentVersionId: 'version-1',
    groups: [],
    questions,
    settings: {
      isPublic: true,
      allowMultipleResponses: true,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '감사합니다.',
      requireInviteToken: false,
    },
    lookups: [],
    createdAt: new Date('2026-09-03T00:00:00.000Z'),
    updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    ...overrides,
  } as Survey;
}

function setMobileViewport(isMobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: isMobile,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function renderFlow(survey: Survey = createSurvey()) {
  render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier="preview-required-gate"
      previewContext={{ survey, versionId: 'version-1' }}
    />,
  );
}

/** 1쪽을 지나 필수 문항이 있는 2쪽에 선다. */
async function goToRequiredPage(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('안내 질문');
  await user.click(screen.getByRole('button', { name: '다음' }));
  await screen.findByText('첫 번째 필수 질문');
}

function questionCard(id: 'q-a' | 'q-b') {
  const title = id === 'q-a' ? '첫 번째 필수 질문' : '두 번째 필수 질문';
  return screen.getByText(title).closest(`[data-question-id="${id}"]`);
}

function getMobileActionButton(name: string) {
  const button = screen
    .getAllByRole('button', { name })
    .find((candidate) => candidate.closest('[class~="md:hidden"]'));
  if (!button) throw new Error(`모바일 ${name} 버튼을 찾지 못했습니다.`);
  return button;
}

beforeEach(() => {
  setMobileViewport(false);
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
  Element.prototype.scrollIntoView = vi.fn();
  useSurveyResponseStore.getState().resetResponseState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('필수 게이트 하단 안내와 강조', () => {
  it('페이지에 들어선 직후에는 하단 안내도 강조도 없다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToRequiredPage(user);

    expect(screen.queryByText(BOTTOM_NOTICE)).toBeNull();
    expect(questionCard('q-a')).not.toHaveClass('ring-red-200');
    expect(questionCard('q-b')).not.toHaveClass('ring-red-200');
    expect(screen.queryAllByText(PER_QUESTION_MESSAGE)).toHaveLength(0);
  });

  it('「다음」에 막히면 미답 필수 문항 전부가 강조되고 문구·하단 안내가 뜬다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToRequiredPage(user);

    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(screen.queryByText('마무리 질문')).toBeNull();
    expect(questionCard('q-a')).toHaveClass('ring-red-200');
    expect(questionCard('q-b')).toHaveClass('ring-red-200');
    expect(screen.getAllByText(PER_QUESTION_MESSAGE)).toHaveLength(2);
    expect(screen.getByText(BOTTOM_NOTICE)).toBeInTheDocument();
    // 스크롤은 첫 문항으로만 간다
    const scrollSpy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    expect(scrollSpy.mock.contexts.at(-1)).toBe(questionCard('q-a'));
  });

  it('한 문항을 답하면 그 문항의 강조·문구만 풀리고 나머지와 하단 안내는 남는다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToRequiredPage(user);
    await user.click(screen.getByRole('button', { name: '다음' }));

    await user.click(screen.getByLabelText('예'));

    expect(questionCard('q-a')).not.toHaveClass('ring-red-200');
    expect(questionCard('q-b')).toHaveClass('ring-red-200');
    expect(screen.getAllByText(PER_QUESTION_MESSAGE)).toHaveLength(1);
    expect(screen.getByText(BOTTOM_NOTICE)).toBeInTheDocument();
  });

  it('전부 답하면 하단 안내가 즉시 사라지고 「다음」이 진행된다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToRequiredPage(user);
    await user.click(screen.getByRole('button', { name: '다음' }));

    await user.click(screen.getByLabelText('예'));
    await user.click(screen.getByLabelText('동의'));

    expect(screen.queryByText(BOTTOM_NOTICE)).toBeNull();
    expect(screen.queryAllByText(PER_QUESTION_MESSAGE)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('마무리 질문')).toBeInTheDocument();
  });

  it('막힌 뒤 다른 페이지로 갔다가 돌아오면 다시 시도하기 전엔 하단 안내가 없다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToRequiredPage(user);
    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByText(BOTTOM_NOTICE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '이전' }));
    await screen.findByText('안내 질문');
    expect(screen.queryByText(BOTTOM_NOTICE)).toBeNull();

    await user.click(screen.getByRole('button', { name: '다음' }));
    await screen.findByText('첫 번째 필수 질문');
    expect(screen.queryByText(BOTTOM_NOTICE)).toBeNull();

    // 다시 시도하면 다시 뜬다
    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByText(BOTTOM_NOTICE)).toBeInTheDocument();
  });

  it('모바일 하단 바의 「필수 질문」 소표시도 시도 뒤에만 뜨고 답을 채우면 사라진다', async () => {
    setMobileViewport(true);
    const user = userEvent.setup();
    renderFlow();
    await screen.findByText('안내 질문');
    await user.click(getMobileActionButton('다음'));
    await screen.findByText('첫 번째 필수 질문');

    expect(screen.queryByText(MOBILE_NOTICE)).toBeNull();

    await user.click(getMobileActionButton('다음'));
    expect(screen.getByText(MOBILE_NOTICE)).toBeInTheDocument();
    expect(screen.queryByText('마무리 질문')).toBeNull();

    await user.click(screen.getByLabelText('예'));
    await user.click(screen.getByLabelText('동의'));
    expect(screen.queryByText(MOBILE_NOTICE)).toBeNull();
  });
});

describe('문항 수요조사 판단 항목', () => {
  const judgementOptions = (prefix: string) => [
    { id: `${prefix}-need`, value: '1', label: '필요함' },
    { id: `${prefix}-drop`, value: '2', label: '필요하지 않음' },
    { id: `${prefix}-opinion`, value: '3', label: '의견', allowTextInput: true },
  ];
  const groups: QuestionGroup[] = [
    { id: 'g-block', surveyId: 'survey-demand', name: '블록 A', order: 0 },
  ];
  const demandQuestions: Question[] = [
    {
      id: 'q-j1',
      type: 'radio',
      title: '첫 판단 문항',
      description: '',
      required: true,
      order: 0,
      groupId: 'g-block',
      options: judgementOptions('j1'),
    },
    {
      id: 'q-j2',
      type: 'radio',
      title: '둘째 판단 문항',
      description: '',
      required: true,
      order: 1,
      groupId: 'g-block',
      options: judgementOptions('j2'),
    },
    {
      id: 'q-after',
      type: 'text',
      title: '조사표 다음 질문',
      description: '',
      required: false,
      order: 2,
      pageBreakBefore: true,
    },
  ] as Question[];

  function renderDemandFlow() {
    render(
      <SurveyResponseFlow
        mode="preview"
        surveyIdentifier="preview-demand-required-gate"
        previewContext={{
          survey: createSurvey({ id: 'survey-demand', groups, questions: demandQuestions }),
          versionId: 'version-1',
          documentView: {
            url: 'https://example.test/doc.pdf',
            pageCount: 1,
            anchors: [
              { ownerKind: 'question', ownerId: 'q-j1', page: 1, x: 0, y: 0, w: 1, h: 1 },
            ],
          },
        }}
      />,
    );
  }

  const row = (id: string) => screen.getByText(id).closest('[data-question-id]');

  it('「다음」에 두 행 모두 강조되고, 「모두 필요함」 한 번에 전부 풀린다', async () => {
    const user = userEvent.setup();
    renderDemandFlow();
    await screen.findByText('첫 판단 문항');
    expect(screen.getByTestId('document-pane')).toBeInTheDocument();
    expect(screen.queryByText(BOTTOM_NOTICE)).toBeNull();

    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(row('첫 판단 문항')).toHaveClass('ring-red-300');
    expect(row('둘째 판단 문항')).toHaveClass('ring-red-300');
    expect(screen.getByText(BOTTOM_NOTICE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '모두 필요함' }));

    expect(row('첫 판단 문항')).not.toHaveClass('ring-red-300');
    expect(row('둘째 판단 문항')).not.toHaveClass('ring-red-300');
    expect(screen.queryByText(BOTTOM_NOTICE)).toBeNull();

    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('조사표 다음 질문')).toBeInTheDocument();
  });
});
