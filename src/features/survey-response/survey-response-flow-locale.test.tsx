import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import type { Question, Survey } from '@/types/survey';

/**
 * 응답 화면의 현재 언어 (CONTEXT.md 「언어 문항」) — 언어 문항의 답에서 파생해 응답 화면을
 * 감싸는 요소의 `lang` 에 싣는다. 고르기 전(미정)에는 `lang` 을 달지 않는다.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function buildSurvey(
  questions: Question[],
  localizedMessages: Survey['settings']['localizedMessages'] = null,
): Survey {
  return {
    id: 'lang-survey',
    title: '다국어 설문',
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
      localizedMessages,
    },
    lookups: [],
    createdAt: new Date('2026-10-27T00:00:00.000Z'),
    updatedAt: new Date('2026-10-27T00:00:00.000Z'),
  } as Survey;
}

const LANG_QUESTION: Question = {
  id: 'lang',
  type: 'radio',
  title: '언어를 선택해 주세요',
  required: true,
  order: 0,
  options: [
    { id: 'o-ko', label: '한국어', value: '1', locale: 'ko' },
    { id: 'o-zh', label: '中文', value: '2', locale: 'zh' },
    { id: 'o-en', label: 'English', value: '3', locale: 'en' },
  ],
};

function renderFlow(
  questions: Question[],
  localizedMessages: Survey['settings']['localizedMessages'] = null,
) {
  return render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier="preview-lang-survey"
      previewContext={{ survey: buildSurvey(questions, localizedMessages), versionId: 'version-1' }}
    />,
  );
}

describe('응답 화면의 현재 언어', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it('언어를 고르기 전에는 lang 을 달지 않고, 고르면 그 언어가 된다', async () => {
    const { container } = renderFlow([LANG_QUESTION]);
    await screen.findByText('언어를 선택해 주세요');
    expect(container.querySelector('[lang]')).toBeNull();

    fireEvent.click(screen.getByText('中文'));
    expect(container.querySelector('[lang]')?.getAttribute('lang')).toBe('zh');

    fireEvent.click(screen.getByText('English'));
    expect(container.querySelector('[lang]')?.getAttribute('lang')).toBe('en');
  });

  it('다국어 설문이 아니면 한국어다', async () => {
    const { container } = renderFlow([
      { id: 'q1', type: 'text', title: '첫 질문', required: false, order: 0 },
    ]);
    await screen.findByText('첫 질문');
    expect(container.querySelector('[lang]')?.getAttribute('lang')).toBe('ko');
  });

  it('언어별 제목 — 고르기 전에는 세 언어 제목을 쌓고, 고르면 그 언어 제목이다', async () => {
    const { container } = renderFlow([LANG_QUESTION], {
      zh: { title: '绩效评估调查' },
      en: { title: 'Performance Evaluation Survey' },
    });
    await screen.findByText('언어를 선택해 주세요');
    const headings = () => [...container.querySelectorAll('h1')].map((h) => h.textContent);
    expect(headings()).toContain('다국어 설문\n绩效评估调查\nPerformance Evaluation Survey');

    fireEvent.click(screen.getByText('中文'));
    expect(headings()).toContain('绩效评估调查');
    expect(headings()).not.toContain('다국어 설문');
  });
});
