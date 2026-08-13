import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import type { SurveyVersionSnapshot } from '@/db/schema';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question, Survey } from '@/types/survey';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const detailedOption = {
  id: 'opt-other',
  value: 'other',
  label: '기타',
  allowTextInput: true,
};

function createSurvey({ required = true, hasNextPage = true } = {}): Survey {
  const requiredQuestion: Question = {
    id: 'q-required',
    type: 'radio',
    title: '필수 기타 질문',
    description: '',
    required,
    order: 0,
    options: [detailedOption],
  };
  const questions: Question[] = [requiredQuestion];
  if (hasNextPage) {
    questions.push({
      id: 'q-next',
      type: 'text',
      title: '다음 페이지 질문',
      description: '',
      required: false,
      order: 1,
      pageBreakBefore: true,
    });
  }

  return {
    id: 'survey-required-option-text',
    title: '상세기입 검증 설문',
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
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    updatedAt: new Date('2026-07-27T00:00:00.000Z'),
  } as Survey;
}

function createChoiceTableSurvey(): Survey {
  const survey = createSurvey();
  return {
    ...survey,
    questions: [
      {
        id: 'q-required',
        type: 'radio',
        title: '필수 기타 질문',
        description: '',
        required: true,
        order: 0,
        tableColumns: [{ id: 'choice-column', label: '선택' }],
        tableRowsData: [
          {
            id: 'choice-row',
            label: '기타 행',
            cells: [
              {
                id: 'choice-other',
                type: 'choice_opt',
                content: '기타',
                allowTextInput: true,
              },
            ],
          },
        ],
      },
      {
        id: 'q-next',
        type: 'text',
        title: '다음 페이지 질문',
        description: '',
        required: false,
        order: 1,
        pageBreakBefore: true,
      },
    ],
  } as Survey;
}

function createTwoRequiredQuestionsSurvey(): Survey {
  const survey = createSurvey({ hasNextPage: true });
  return {
    ...survey,
    questions: [
      {
        id: 'q-first-required',
        type: 'radio',
        title: '첫 번째 필수 질문',
        description: '',
        required: true,
        order: 0,
        options: [
          { id: 'first-yes', value: 'yes', label: '예' },
          { id: 'first-no', value: 'no', label: '아니오' },
        ],
      },
      {
        id: 'q-second-required',
        type: 'radio',
        title: '두 번째 필수 질문',
        description: '',
        required: true,
        order: 1,
        options: [
          { id: 'second-yes', value: 'yes', label: '동의' },
          { id: 'second-no', value: 'no', label: '비동의' },
        ],
      },
      {
        id: 'q-next',
        type: 'text',
        title: '다음 페이지 질문',
        description: '',
        required: false,
        order: 2,
        pageBreakBefore: true,
      },
    ],
  } as Survey;
}

function renderFlow(options?: Parameters<typeof createSurvey>[0]) {
  render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier="preview-required-option-text"
      previewContext={{ survey: createSurvey(options), versionId: 'version-1' }}
    />,
  );
}

function renderTwoRequiredQuestionsFlow() {
  render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier="preview-two-required-questions"
      previewContext={{ survey: createTwoRequiredQuestionsSurvey(), versionId: 'version-1' }}
    />,
  );
}

function renderAdminFlow(
  initialResponses: Record<string, unknown>,
  onSubmit: (payload: { questionResponses: Record<string, unknown> }) => Promise<void>,
) {
  const survey = createSurvey({ hasNextPage: false });
  const versionSnapshot: SurveyVersionSnapshot = {
    title: survey.title,
    questions: survey.questions as SurveyVersionSnapshot['questions'],
    groups: [],
    settings: {
      isPublic: true,
      allowMultipleResponses: true,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '감사합니다.',
    },
  };
  render(
    <SurveyResponseFlow
      mode="admin-edit"
      surveyIdentifier="admin-required-option-text"
      adminContext={{
        responseId: 'response-1',
        surveyId: survey.id,
        initialResponses,
        versionSnapshot,
        initialContactAttrs: {},
        onSubmit,
      }}
    />,
  );
}

function renderMobileChoiceTableAdminFlow(optionText: string) {
  setMobileViewport(true);
  const survey = createChoiceTableSurvey();
  const versionSnapshot: SurveyVersionSnapshot = {
    title: survey.title,
    questions: survey.questions as SurveyVersionSnapshot['questions'],
    groups: [],
    settings: {
      isPublic: true,
      allowMultipleResponses: true,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '감사합니다.',
    },
  };
  render(
    <SurveyResponseFlow
      mode="admin-edit"
      surveyIdentifier="admin-choice-table-required-option-text"
      adminContext={{
        responseId: 'response-choice-table',
        surveyId: survey.id,
        initialResponses: {
          'q-required': 'choice-other',
          __optTexts__: {
            'q-required': { 'choice-other': optionText },
          },
        },
        versionSnapshot,
        initialContactAttrs: {},
        onSubmit: vi.fn().mockResolvedValue(undefined),
      }}
    />,
  );
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

function renderMobileFlow(options?: Parameters<typeof createSurvey>[0]) {
  setMobileViewport(true);
  renderFlow(options);
}

async function selectDetailedOption() {
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText('기타'));
  return user;
}

function expectRequiredHighlight() {
  expect(screen.getByText('필수 기타 질문').closest('[data-question-id="q-required"]')).toHaveClass(
    'ring-red-200',
  );
}

function getMobileActionButton(name: string) {
  const button = screen
    .getAllByRole('button', { name })
    .find((candidate) => candidate.closest('[class~="md:hidden"]'));
  if (!button) throw new Error(`모바일 ${name} 버튼을 찾지 못했습니다.`);
  return button;
}

describe('필수 옵션 상세기입 응답 흐름', () => {
  beforeEach(() => {
    setMobileViewport(false);
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
    useSurveyResponseStore.getState().resetResponseState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('미입력 필수 문항은 첫 번째만 표시하고 입력 후 다음 문항으로 오류 대상을 갱신한다', async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    renderTwoRequiredQuestionsFlow();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '다음' }));

    const firstQuestion = screen
      .getByText('첫 번째 필수 질문')
      .closest('[data-question-id="q-first-required"]');
    const secondQuestion = screen
      .getByText('두 번째 필수 질문')
      .closest('[data-question-id="q-second-required"]');
    expect(firstQuestion).toHaveClass('ring-red-200');
    expect(secondQuestion).not.toHaveClass('ring-red-200');
    expect(scrollSpy.mock.contexts.at(-1)).toBe(firstQuestion);

    await user.click(screen.getByLabelText('예'));
    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(firstQuestion).not.toHaveClass('ring-red-200');
    expect(secondQuestion).toHaveClass('ring-red-200');
    expect(scrollSpy.mock.contexts.at(-1)).toBe(secondQuestion);
    expect(screen.queryByText('다음 페이지 질문')).not.toBeInTheDocument();
  });

  it.each(['', '   '])(
    '필수 상세기입이 %j이면 다음 페이지로 이동하지 않고 질문을 하이라이트한다',
    async (optionText) => {
      renderFlow();
      const user = await selectDetailedOption();
      act(() => {
        useSurveyResponseStore.getState().setOptionText('q-required', 'opt-other', optionText);
      });

      await user.click(screen.getByRole('button', { name: '다음' }));

      expect(screen.queryByText('다음 페이지 질문')).not.toBeInTheDocument();
      expectRequiredHighlight();
    },
  );

  it('필수 상세기입이 유효하면 다음 페이지로 이동한다', async () => {
    renderFlow();
    const user = await selectDetailedOption();
    act(() => {
      useSurveyResponseStore.getState().setOptionText('q-required', 'opt-other', '상세 내용');
    });

    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(await screen.findByText('다음 페이지 질문')).toBeVisible();
  });

  it('선택 사항 상세기입은 공백이어도 다음 페이지로 이동한다', async () => {
    renderFlow({ required: false });
    const user = await selectDetailedOption();
    act(() => {
      useSurveyResponseStore.getState().setOptionText('q-required', 'opt-other', '   ');
    });

    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(await screen.findByText('다음 페이지 질문')).toBeVisible();
  });

  it('필수 상세기입이 공백이면 완료도 차단하고 질문을 하이라이트한다', async () => {
    renderFlow({ hasNextPage: false });
    const user = await selectDetailedOption();
    act(() => {
      useSurveyResponseStore.getState().setOptionText('q-required', 'opt-other', '   ');
    });

    // 2026-08-12 미리보기 마지막 페이지 라벨도 '다음'으로 통일 (8a7fba50)
    const completeButton = screen.getByRole('button', { name: '다음' });
    expect(completeButton.querySelector('svg')).not.toBeNull();
    await user.click(completeButton);

    expect(screen.getByText('필수 기타 질문')).toBeVisible();
    expectRequiredHighlight();
  });

  it('모바일에서 빈 필수 상세기입은 다음을 차단하고 질문을 하이라이트한다', async () => {
    renderMobileFlow();
    const user = await selectDetailedOption();
    act(() => {
      useSurveyResponseStore.getState().setOptionText('q-required', 'opt-other', '');
    });

    await user.click(getMobileActionButton('다음'));

    expect(screen.queryByText('다음 페이지 질문')).not.toBeInTheDocument();
    expectRequiredHighlight();
    // 문구는 필수 안내 하나로 합치고 배너의 위치로 이동 버튼은 유지한다 (2026-08-13)
    expect(screen.getByRole('alert')).toHaveTextContent('필수 질문에 답변해주세요.');
    expect(screen.getAllByText('필수 질문에 답변해주세요.')).toHaveLength(1);
    expect(screen.queryByText('필수 응답이 비어있습니다')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '위치로 이동' })).toBeVisible();
  });

  it('모바일에서 공백 필수 상세기입은 완료를 차단하고 질문을 하이라이트한다', async () => {
    renderMobileFlow({ hasNextPage: false });
    const user = await selectDetailedOption();
    act(() => {
      useSurveyResponseStore.getState().setOptionText('q-required', 'opt-other', '   ');
    });

    // 2026-08-12 미리보기 마지막 페이지 라벨도 '다음'으로 통일 (8a7fba50)
    const completeButton = getMobileActionButton('다음');
    expect(completeButton.querySelector('svg')).not.toBeNull();
    await user.click(completeButton);

    expect(screen.getByText('필수 기타 질문')).toBeVisible();
    expectRequiredHighlight();
    // 문구는 필수 안내 하나로 합치고 배너의 위치로 이동 버튼은 유지한다 (2026-08-13)
    expect(screen.getByRole('alert')).toHaveTextContent('필수 질문에 답변해주세요.');
    expect(screen.getAllByText('필수 질문에 답변해주세요.')).toHaveLength(1);
    expect(screen.queryByText('필수 응답이 비어있습니다')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '위치로 이동' })).toBeVisible();
  });

  it('모바일에서 유효한 필수 상세기입은 다음 페이지로 이동한다', async () => {
    renderMobileFlow();
    const user = await selectDetailedOption();
    act(() => {
      useSurveyResponseStore.getState().setOptionText('q-required', 'opt-other', '상세 내용');
    });

    await user.click(getMobileActionButton('다음'));

    expect(await screen.findByText('다음 페이지 질문')).toBeVisible();
  });

  it.each(['', '   '])(
    '모바일 choice-table 초기 상세기입이 %j이면 배너를 표시하고 실제 입력으로 이동한 뒤 유효 입력 시 진행한다',
    async (optionText) => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;
      renderMobileChoiceTableAdminFlow(optionText);
      const user = userEvent.setup();

      const detailInput = await screen.findByPlaceholderText('상세 기재');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await user.click(getMobileActionButton('다음'));

      expect(screen.queryByText('다음 페이지 질문')).not.toBeInTheDocument();
      // admin-edit 은 첫 클릭에서 빈 필수를 앰버 경고로 알리고 위치로 이동 버튼을 유지한다
      // (2026-08-13 재결정 — 결정 6, 경고 1회 후 재클릭 시 통과).
      expect(screen.getByRole('alert')).toHaveTextContent(
        '빈 필수 응답 1개 — 한 번 더 누르면 그대로 넘어갑니다',
      );
      expect(screen.queryByText('필수 응답이 비어있습니다')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '위치로 이동' }));
      expect(scrollSpy).toHaveBeenCalledTimes(2);
      expect(scrollSpy.mock.contexts[0]).toBe(detailInput);
      expect(scrollSpy.mock.contexts[1]).toBe(detailInput);

      await user.clear(detailInput);
      await user.type(detailInput, '상세 내용');
      await user.click(getMobileActionButton('다음'));

      expect(await screen.findByText('다음 페이지 질문')).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('관리자 응답의 저장된 루트 상세기입으로 필수 질문 검증을 통과한다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderAdminFlow(
      {
        'q-required': 'other',
        __optTexts__: {
          'q-required': { 'opt-other': '저장된 상세기입' },
        },
      },
      onSubmit,
    );
    const user = userEvent.setup();

    await screen.findByText('필수 기타 질문');
    await user.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('현재 편집에서 저장된 상세기입을 지우면 관리자 완료를 차단한다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderAdminFlow(
      {
        'q-required': 'other',
        __optTexts__: {
          'q-required': { 'opt-other': '저장된 상세기입' },
        },
      },
      onSubmit,
    );
    const user = userEvent.setup();
    const detailInput = await screen.findByPlaceholderText('상세 기재');
    await user.type(detailInput, '임시 입력');
    await user.clear(detailInput);

    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expectRequiredHighlight();
  });

  // 2026-08-13 재결정(결정 6) — admin-edit 전용 "빈 필수 경고 1회 후 통과" 상태 머신을
  // handleNext/handleSubmit 직접 호출이 아니라 실제 컴포넌트 클릭으로 구동해 검증한다.
  describe('admin-edit — 빈 필수 경고 1회 후 통과(결정 6)', () => {
    it('빈 필수는 첫 클릭에서 경고만 하고, 값 변경 없는 두 번째 클릭에서 통과해 저장한다', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      // q-required 를 전혀 응답하지 않은 상태(initialResponses={}) — 단일 페이지라
      // "다음" 버튼이 곧 최종 제출이다.
      renderAdminFlow({}, onSubmit);
      const user = userEvent.setup();

      await screen.findByText('필수 기타 질문');
      const nextButton = () => screen.getByRole('button', { name: '다음' });

      // 첫 클릭 — 진행을 막고 앰버 경고 배너만 표시한다.
      await user.click(nextButton());

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        '빈 필수 응답 1개 — 한 번 더 누르면 그대로 넘어갑니다',
      );
      expectRequiredHighlight();

      // 같은 페이지, 값 변경 없이 연속 두 번째 클릭 — 완화하고 저장을 진행한다.
      await user.click(nextButton());

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    });

    it('경고 후 값이 바뀌면(여전히 빈 필수) 경고 상태가 리셋되어 다시 첫 클릭이 경고가 된다', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      renderAdminFlow({}, onSubmit);
      const user = userEvent.setup();

      await screen.findByText('필수 기타 질문');
      const nextButton = () => screen.getByRole('button', { name: '다음' });

      // 1차 클릭 — 경고.
      await user.click(nextButton());
      expect(screen.getByRole('alert')).toHaveTextContent(
        '빈 필수 응답 1개 — 한 번 더 누르면 그대로 넘어갑니다',
      );

      // 옵션만 선택하고 상세기입은 비워둔다 — 여전히 빈 필수(required-detail)지만
      // 응답값 자체는 바뀌었으므로 스냅샷이 달라져 경고 상태가 리셋되어야 한다.
      await user.click(await screen.findByLabelText('기타'));

      // 값이 바뀐 뒤의 재클릭 — 리셋되어 "첫 클릭"으로 취급, 다시 경고만 하고 통과시키지 않는다.
      await user.click(nextButton());
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        '빈 필수 응답 1개 — 한 번 더 누르면 그대로 넘어갑니다',
      );

      // 값 변경 없는 다음 클릭(3차) — 이번엔 통과한다.
      await user.click(nextButton());
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    });
  });
});
