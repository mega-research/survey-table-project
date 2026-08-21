import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/question-renderer/stores/survey-response-store';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
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

/**
 * identityKey 회귀 테스트용 설문.
 *
 * `{{입력}}` 인용 문구를 쓰는 "기타" 옵션 하나만 둔다 — 이 경로는 응답자가 직접 입력한
 * 텍스트가 Zustand `optionTexts` 스토어(questionId -> optionId -> text)를 거쳐 인용값에
 * 반영되므로, 이 스토어가 두 응답 사이에 리셋되지 않으면 리크가 관측 가능하다.
 */
function createFreeTextQuoteSurvey(): Survey {
  const otherQuestion: Question = {
    id: 'q-other',
    type: 'radio',
    title: '이름을 알려주세요',
    description: '',
    required: false,
    order: 0,
    answerQuoteEnabled: true,
    answerQuoteName: '이름',
    options: [
      {
        id: 'opt-other',
        value: 'other',
        label: '기타',
        allowTextInput: true,
        answerQuoteText: '{{입력}}',
      },
    ],
  };
  const quotingQuestion: Question = {
    id: 'q-quoting',
    type: 'text',
    title: '{{{이름}}}님, 확인해주세요',
    description: '',
    required: false,
    order: 1,
  };

  return {
    id: 'survey-admin-quote-leak',
    title: '응답 인용 identity 경계 설문',
    status: 'published',
    currentVersionId: 'version-1',
    groups: [],
    questions: [otherQuestion, quotingQuestion],
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

function buildFreeTextVersionSnapshot(survey: Survey): SurveyVersionSnapshot {
  return {
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
}

function adminEditElementFor(
  survey: Survey,
  responseId: string,
  initialResponses: Record<string, unknown>,
) {
  return (
    <SurveyResponseFlow
      mode="admin-edit"
      surveyIdentifier={survey.id}
      adminContext={{
        responseId,
        surveyId: survey.id,
        initialResponses,
        versionSnapshot: buildFreeTextVersionSnapshot(survey),
        initialContactAttrs: {},
        onSubmit: vi.fn().mockResolvedValue(undefined),
      }}
    />
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

  it(
    '같은 마운트 트리에서 응답 상세의 responseId만 바뀌면 이전 응답의 라이브 입력이 ' +
      '다음 응답의 인용에 새어 들어가지 않는다 (identityKey 회귀)',
    async () => {
      const survey = createFreeTextQuoteSurvey();

      const { rerender } = render(
        adminEditElementFor(survey, 'response-1', {
          'q-other': 'other',
          __optTexts__: { 'q-other': { 'opt-other': 'response-1-저장값' } },
        }),
      );

      expect(await screen.findByText('response-1-저장값님, 확인해주세요')).toBeInTheDocument();

      // 운영자가 response-1 화면에서 "기타" 입력칸에 아직 저장하지 않은 텍스트를 치는 상황을
      // 재현한다 — 이 값은 Zustand optionTexts 스토어에만 있고 initialResponses에는 없다.
      act(() => {
        useSurveyResponseStore.getState().setOptionText('q-other', 'opt-other', '라이브-입력-누출');
      });
      expect(await screen.findByText('라이브-입력-누출님, 확인해주세요')).toBeInTheDocument();

      // 같은 마운트 트리 안에서 responseId만 다른 응답으로 바꾼다(가상의 "다음 응답" 이동).
      rerender(
        adminEditElementFor(survey, 'response-2', {
          'q-other': 'other',
          __optTexts__: { 'q-other': { 'opt-other': 'response-2-저장값' } },
        }),
      );

      // response-2 자신의 저장값으로 재현돼야 한다 — response-1에서 라이브로 치던 텍스트가
      // 새어 들어오면 안 된다. identityKey에 responseId가 빠져 있으면 remount가 일어나지
      // 않아 store의 optionTexts가 리셋되지 않고, "라이브-입력-누출"이 그대로 남아 이
      // 단언이 실패한다.
      expect(await screen.findByText('response-2-저장값님, 확인해주세요')).toBeInTheDocument();
      expect(screen.queryByText('라이브-입력-누출님, 확인해주세요')).not.toBeInTheDocument();
    },
  );
});
