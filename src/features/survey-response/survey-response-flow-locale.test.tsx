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

/** 언어 문항과 같은 페이지의 필수 문항 + 다음 페이지 문항 — 언어 페이지 자동 넘김(04)이 걸리지 않는다. */
const SYSTEM_TEXT_QUESTIONS: Question[] = [
  LANG_QUESTION,
  { id: 'name', type: 'text', title: '성명', required: true, order: 1 },
  {
    id: 'later',
    type: 'text',
    title: '다음 페이지',
    required: false,
    order: 2,
    pageBreakBefore: true,
  },
];

const DOCUMENT_QUESTION: Question = {
  id: 'doc-q',
  type: 'radio',
  title: '조사표 문항',
  required: false,
  order: 1,
  pageBreakBefore: true,
  options: [{ id: 'd1', label: '필요함', value: '1' }],
};

const DOCUMENT_VIEW = {
  url: 'https://example.test/doc.pdf',
  pageCount: 1,
  anchors: [{ ownerKind: 'question' as const, ownerId: 'doc-q', page: 1, x: 0, y: 0, w: 1, h: 1 }],
};

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function renderFlow(
  questions: Question[],
  localizedMessages: Survey['settings']['localizedMessages'] = null,
  documentView: typeof DOCUMENT_VIEW | null = null,
) {
  return render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier="preview-lang-survey"
      previewContext={{
        survey: buildSurvey(questions, localizedMessages),
        versionId: 'version-1',
        documentView,
      }}
    />,
  );
}

describe('응답 화면의 현재 언어', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    // 필수 안내로 스크롤한다 — jsdom 에는 scrollIntoView 가 없다
    Element.prototype.scrollIntoView = vi.fn();
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

  it('중국어를 고르면 이동 버튼과 필수 안내가 중국어다', async () => {
    renderFlow(SYSTEM_TEXT_QUESTIONS);
    await screen.findByText('언어를 선택해 주세요');
    expect(screen.getByRole('button', { name: /다음/ })).toBeInTheDocument();

    fireEvent.click(screen.getByText('中文'));
    expect(screen.getByRole('button', { name: /上一步/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /다음/ })).toBeNull();

    // 같은 페이지의 필수 문항을 비운 채 넘기면 필수 안내가 중국어로 나온다
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    expect(await screen.findByText('* 请回答必答题')).toBeInTheDocument();
  });

  it('모바일 하단 내비와 응답 진행도 고른 언어다', async () => {
    mockMatchMedia(true);
    renderFlow(SYSTEM_TEXT_QUESTIONS);
    await screen.findByText('언어를 선택해 주세요');

    fireEvent.click(screen.getByText('English'));
    expect(screen.getAllByRole('button', { name: /Next/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Previous/ }).length).toBeGreaterThan(0);
    expect(screen.getByText('1/3 answered')).toBeInTheDocument();
  });

  it('언어를 고르기 전의 안내 화면은 세 언어를 위아래로 함께 보인다', async () => {
    // 조사표를 끼는 설문을 좁은 화면에서 열면 언어를 고르기 전에 PC 안내가 설문 전체를 막는다
    mockMatchMedia(true);
    renderFlow([LANG_QUESTION, DOCUMENT_QUESTION], null, DOCUMENT_VIEW);

    expect(await screen.findByText('PC 에서 열어 주세요')).toBeInTheDocument();
    expect(screen.getByText('请在电脑上打开')).toBeInTheDocument();
    expect(screen.getByText('Please open this on a PC')).toBeInTheDocument();
  });

  it('다국어 설문이 아니면 안내 화면은 지금처럼 한국어 하나다', async () => {
    mockMatchMedia(true);
    const { container } = renderFlow([DOCUMENT_QUESTION], null, DOCUMENT_VIEW);

    const heading = await screen.findByRole('heading', { name: 'PC 에서 열어 주세요' });
    expect(heading.textContent).toBe('PC 에서 열어 주세요');
    expect(container.textContent).not.toMatch(/请|Please/);
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
