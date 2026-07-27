import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
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

function renderFlow(options?: Parameters<typeof createSurvey>[0]) {
  render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier="preview-required-option-text"
      previewContext={{ survey: createSurvey(options), versionId: 'version-1' }}
    />,
  );
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

describe('필수 옵션 상세기입 응답 흐름', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
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
});
