import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { Question, Survey } from '@/types/survey';

const {
  forResponse,
  attrsLookup,
  priorAnswersLookup,
  resume,
  stepVisit,
  createWithFirstAnswer,
  saveDraft,
  complete,
  createBlank,
  checkOnEntry,
} = vi.hoisted(() => ({
  forResponse: vi.fn(),
  attrsLookup: vi.fn(),
  priorAnswersLookup: vi.fn(),
  resume: vi.fn(),
  stepVisit: vi.fn(),
  createWithFirstAnswer: vi.fn(),
  saveDraft: vi.fn(),
  complete: vi.fn(),
  createBlank: vi.fn(),
  checkOnEntry: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      publicRead: {
        bySlug: vi.fn(),
        byPrivateToken: vi.fn(async () => null),
        forResponse: (...args: unknown[]) => forResponse(...args),
      },
    },
    contacts: {
      attrs: { lookup: (...args: unknown[]) => attrsLookup(...args) },
      priorAnswers: { lookup: (...args: unknown[]) => priorAnswersLookup(...args) },
    },
    surveyResponse: {
      lifecycle: {
        stepVisit: (...args: unknown[]) => stepVisit(...args),
        resume: (...args: unknown[]) => resume(...args),
      },
      response: {
        createWithFirstAnswer: (...args: unknown[]) => createWithFirstAnswer(...args),
        createBlank: (...args: unknown[]) => createBlank(...args),
        saveDraft: (...args: unknown[]) => saveDraft(...args),
        complete: (...args: unknown[]) => complete(...args),
      },
      duplicate: { checkOnEntry: (...args: unknown[]) => checkOnEntry(...args) },
    },
    quota: { check: vi.fn() },
  },
}));

const questions: Question[] = [
  {
    id: 'q-prior',
    type: 'text',
    title: '지난 회차에 답한 질문',
    description: '',
    required: false,
    order: 0,
  },
  {
    id: 'q-new',
    type: 'text',
    title: '올해 새로 생긴 질문',
    description: '',
    required: false,
    order: 1,
  },
  {
    id: 'q-second-page',
    type: 'text',
    title: '두 번째 페이지 질문',
    description: '',
    required: false,
    order: 2,
    pageBreakBefore: true,
  },
] as Question[];

function createSurvey(overrides: Partial<Survey> = {}): Survey {
  return {
    id: 'survey-tracking',
    title: '추적조사 설문',
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
    createdAt: new Date('2026-08-31T00:00:00.000Z'),
    updatedAt: new Date('2026-08-31T00:00:00.000Z'),
    ...overrides,
  } as Survey;
}

function renderFlow({ invite = true }: { invite?: boolean } = {}) {
  render(
    <SurveyResponseFlow
      mode="public"
      surveyIdentifier="survey-tracking"
      {...(invite ? { inviteToken: 'invite-1' } : {})}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  window.localStorage.clear();
  useSurveyResponseStore.getState().resetResponseState();
  Element.prototype.scrollIntoView = vi.fn();
  forResponse.mockResolvedValue({
    survey: createSurvey(),
    versionId: 'version-1',
    control: {
      isPaused: false,
      pausedMessage: null,
      testSession: null,
      testSessionKind: null,
      priorWaveLabel: '2025년 조사',
      changeConfirmEnabled: false,
    },
  });
  attrsLookup.mockResolvedValue({});
  priorAnswersLookup.mockResolvedValue({ 'q-prior': '작년 답' });
  resume.mockResolvedValue(null);
  checkOnEntry.mockResolvedValue({ status: 'ok' });
  stepVisit.mockResolvedValue(undefined);
  saveDraft.mockResolvedValue({ applied: true });
  createWithFirstAnswer.mockResolvedValue({
    kind: 'created',
    id: 'response-1',
    versionId: 'version-1',
    contactTargetId: 'contact-1',
  });
  createBlank.mockResolvedValue({
    kind: 'created',
    id: 'response-1',
    versionId: 'version-1',
    contactTargetId: 'contact-1',
  });
  complete.mockResolvedValue({ id: 'response-1' });
});


afterEach(() => {
  vi.useRealTimers();
});

/**
 * 이어하기 회복과 이월 값 깔기가 같은 순간에 시작될 때 (2026-11-06 — 회복 전 쓰기가 저장본을 덮는 결함 군).
 *
 * 이월 값 깔기는 프리필이 정착한 커밋에서 회복과 함께 시작한다. 그 깔기가 「응답자의 첫 답」으로 취급되면
 * 링크를 열기만 해도 응답 행을 만들고(서버는 같은 컨택의 진행 중 행을 물려받아 그 문항을 작년 값으로 덮는다),
 * 생성 결과가 회복보다 먼저 돌아오면 회복이 취소돼 저장된 답이 화면에 깔리지 않는다.
 */
describe('이월 값 깔기와 이어하기 회복', () => {
  it('링크를 열기만 해서는 응답 행을 만들지 않고, 저장된 답을 화면에 되살린다', async () => {
    window.localStorage.setItem('survey-session:survey-tracking:invite:invite-1', 'saved-session');
    let resolveResume!: (v: unknown) => void;
    resume.mockReturnValue(new Promise((r) => (resolveResume = r)));

    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    // 회복이 아직 도는 동안
    await new Promise((r) => setTimeout(r, 50));
    expect(createWithFirstAnswer).not.toHaveBeenCalled();

    resolveResume({
      id: 'response-1',
      status: 'in_progress',
      resumed: false,
      questionResponses: { 'q-prior': '올해 고친 답', 'q-new': '새 답' },
      currentStepId: null,
    });
    await waitFor(() =>
      expect((screen.getAllByRole('textbox')[1] as HTMLInputElement).value).toBe('새 답'),
    );
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('올해 고친 답');
    expect(createWithFirstAnswer).not.toHaveBeenCalled();
  });
});
