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

function renderFlow(options?: Parameters<typeof createSurvey>[0]) {
  render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier="preview-required-option-text"
      previewContext={{ survey: createSurvey(options), versionId: 'version-1' }}
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

    await user.click(screen.getByRole('button', { name: '확인 완료' }));

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
    expect(screen.getByRole('alert')).toHaveTextContent('필수 응답이 비어있습니다');
    expect(screen.getByRole('button', { name: '위치로 이동' })).toBeVisible();
  });

  it('모바일에서 공백 필수 상세기입은 완료를 차단하고 질문을 하이라이트한다', async () => {
    renderMobileFlow({ hasNextPage: false });
    const user = await selectDetailedOption();
    act(() => {
      useSurveyResponseStore.getState().setOptionText('q-required', 'opt-other', '   ');
    });

    await user.click(getMobileActionButton('확인 완료'));

    expect(screen.getByText('필수 기타 질문')).toBeVisible();
    expectRequiredHighlight();
    expect(screen.getByRole('alert')).toHaveTextContent('필수 응답이 비어있습니다');
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
      expect(screen.getByRole('alert')).toHaveTextContent('필수 응답이 비어있습니다');
      await user.click(screen.getByRole('button', { name: '위치로 이동' }));
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy.mock.contexts[0]).toBe(detailInput);

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
});
