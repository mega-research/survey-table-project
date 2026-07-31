import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import type { SurveyVersionSnapshot } from '@/db/schema';
import type { Question, Survey } from '@/types/survey';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * Task 11 회귀 테스트.
 *
 * 운영 콘솔의 응답 상세(admin-edit 모드)가 그 응답자가 실제로 봤던 문장(응답 인용이 반영된
 * 제목)을 재현하는지 검증한다. survey-response-flow.tsx 는 mode 와 무관하게
 * collectAnswerQuotes(questions, responses, ...) 를 계산해 ContactAttrsProvider 에 quotes 로
 * 흘려보내므로, admin-edit 초기 prefill(adminContext.initialResponses → setResponses)만 응답자가
 * 실제로 낸 답과 같으면 별도 배선 없이 동작해야 한다. 이 테스트가 잡으려는 회귀:
 * - answerQuotes 계산이 mode==='public' 으로 조건 분기되는 경우
 * - admin-edit 초기 prefill이 quotes 계산에 쓰이는 responses state 에 반영되지 않는 경우
 */
function createQuoteSurvey(): Survey {
  const quoteQuestion: Question = {
    id: 'q-quote-source',
    type: 'radio',
    title: '선호하는 이름을 골라주세요',
    description: '',
    required: false,
    order: 0,
    answerQuoteEnabled: true,
    answerQuoteName: '이름',
    options: [
      { id: 'opt-hong', value: 'hong', label: '홍길동', answerQuoteText: '홍길동' },
      { id: 'opt-kim', value: 'kim', label: '김철수', answerQuoteText: '김철수' },
    ],
  };
  const quotingQuestion: Question = {
    id: 'q-quoting',
    type: 'text',
    title: '{{{이름}}}님, 아래 내용을 확인해주세요',
    description: '',
    required: false,
    order: 1,
  };

  return {
    id: 'survey-admin-quote',
    title: '응답 인용 어드민 재현 설문',
    status: 'published',
    currentVersionId: 'version-1',
    groups: [],
    questions: [quoteQuestion, quotingQuestion],
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
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
    updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  } as Survey;
}

function renderAdminEditFlow(initialResponses: Record<string, unknown>) {
  const survey = createQuoteSurvey();
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
      surveyIdentifier={survey.id}
      adminContext={{
        responseId: 'response-1',
        surveyId: survey.id,
        initialResponses,
        versionSnapshot,
        initialContactAttrs: {},
        onSubmit: vi.fn().mockResolvedValue(undefined),
      }}
    />,
  );
}

describe('운영 콘솔 응답 상세 — 응답 인용 재현', () => {
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

  it('저장된 응답값으로 응답 인용이 반영된 제목을 그대로 재현한다', async () => {
    renderAdminEditFlow({ 'q-quote-source': 'hong' });

    expect(
      await screen.findByText('홍길동님, 아래 내용을 확인해주세요'),
    ).toBeInTheDocument();
    expect(screen.queryByText('{{{이름}}}님, 아래 내용을 확인해주세요')).not.toBeInTheDocument();
  });

  it('저장된 응답값이 바뀌면 재현된 제목도 그 값을 따라간다', async () => {
    renderAdminEditFlow({ 'q-quote-source': 'kim' });

    expect(
      await screen.findByText('김철수님, 아래 내용을 확인해주세요'),
    ).toBeInTheDocument();
  });

  it('인용 대상 질문이 미응답이면 인용 자리는 빈 문자열로 렌더된다(토큰 리터럴 노출 금지)', async () => {
    renderAdminEditFlow({});

    expect(await screen.findByText('님, 아래 내용을 확인해주세요')).toBeInTheDocument();
    expect(screen.queryByText(/\{\{\{이름\}\}\}/)).not.toBeInTheDocument();
  });
});
