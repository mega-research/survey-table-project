import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question, Survey } from '@/types/survey';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/** 1쪽: 응답 품질 검사가 걸린 장문형(필수 아님) / 2쪽: 마무리 문항 */
const questions: Question[] = [
  {
    id: 'q-opinion',
    type: 'textarea',
    title: '개선 의견',
    description: '',
    required: false,
    order: 0,
    textValidation: { minLength: 10, rejectMeaningless: true },
  },
  {
    id: 'q-last',
    type: 'text',
    title: '마무리 질문',
    description: '',
    required: false,
    order: 1,
    pageBreakBefore: true,
  },
] as Question[];

function createSurvey(): Survey {
  return {
    id: 'survey-text-quality',
    title: '응답 품질 설문',
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
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    updatedAt: new Date('2026-09-15T00:00:00.000Z'),
  } as Survey;
}

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
  Element.prototype.scrollIntoView = vi.fn();
  useSurveyResponseStore.getState().resetResponseState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('응답 품질 검사 — 「다음」 차단 흐름', () => {
  it('자음만 쓰면 문구가 뜨고 「다음」이 막히며, 내용을 채우면 넘어간다', async () => {
    const user = userEvent.setup();
    render(
      <SurveyResponseFlow
        mode="preview"
        surveyIdentifier="preview-text-quality"
        previewContext={{ survey: createSurvey(), versionId: 'version-1' }}
      />,
    );
    const textarea = await screen.findByPlaceholderText('답변을 입력하세요...');

    await user.type(textarea, 'ㅋㅋㅋ');
    expect(screen.getByTestId('text-quality-violation')).toHaveTextContent(
      '자음·모음이나 숫자만으로는 답할 수 없습니다.',
    );
    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.queryByText('마무리 질문')).toBeNull();

    await user.clear(textarea);
    await user.type(textarea, '너무 짧음');
    expect(screen.getByTestId('text-quality-violation')).toHaveTextContent(
      '10자 이상 입력해 주세요.',
    );
    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.queryByText('마무리 질문')).toBeNull();

    await user.clear(textarea);
    await user.type(textarea, '응답 화면이 느려서 개선이 필요합니다');
    expect(screen.queryByTestId('text-quality-violation')).toBeNull();
    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('마무리 질문')).toBeInTheDocument();
  });

  it('비워 두면 막지 않는다 — 미입력은 필수 판정 소관이고 이 문항은 필수가 아니다', async () => {
    const user = userEvent.setup();
    render(
      <SurveyResponseFlow
        mode="preview"
        surveyIdentifier="preview-text-quality-empty"
        previewContext={{ survey: createSurvey(), versionId: 'version-1' }}
      />,
    );
    await screen.findByPlaceholderText('답변을 입력하세요...');
    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('마무리 질문')).toBeInTheDocument();
  });
});
