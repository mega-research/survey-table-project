import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  { id: 'q-keep', type: 'text', title: '남는 질문', description: '', required: false, order: 0 },
  { id: 'q-gone', type: 'text', title: '새 버전에서 지워진 질문', description: '', required: false, order: 1 },
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
  priorAnswersLookup.mockResolvedValue({});
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
 * 응답 도중 재발행으로 서버가 응답을 새 버전에 다시 묶었을 때 (무중단 갈아타기).
 *
 * 화면은 새 구조로 응답을 거르지만 저장 대기열은 그대로였다 — 새 버전에 없는 문항의 답이 대기열에
 * 남으면 서버의 소속 검증이 초안 묶음 전체를 거부해(부분 저장 없음) 그 뒤 임시 저장이 계속 실패했다.
 */
describe('버전 갈아타기와 저장 대기열', () => {
  it('새 버전에 없는 문항의 미저장 답은 초안 저장에 싣지 않는다', async () => {
    const user = userEvent.setup();
    // 첫 로드는 옛 버전, 갈아타기 재취득은 q-gone 이 지워진 새 버전
    forResponse.mockResolvedValueOnce({
      survey: createSurvey(),
      versionId: 'version-1',
      control: { isPaused: false, pausedMessage: null, testSession: null, testSessionKind: null },
    });
    forResponse.mockResolvedValue({
      survey: createSurvey({ questions: [questions[0]!, questions[2]!] as Question[] }),
      versionId: 'version-2',
      control: { isPaused: false, pausedMessage: null, testSession: null, testSessionKind: null },
    });
    createWithFirstAnswer.mockResolvedValue({
      kind: 'created',
      id: 'response-1',
      versionId: 'version-2',
      contactTargetId: null,
    });

    renderFlow({ invite: false });
    await screen.findByText('새 버전에서 지워진 질문');
    await user.type(screen.getAllByRole('textbox')[1]!, '곧 지워질 답');
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalled());
    // 재취득으로 새 버전이 깔리면 지워진 질문이 화면에서 사라진다
    await waitFor(() => expect(screen.queryByText('새 버전에서 지워진 질문')).toBeNull());

    await user.type(screen.getAllByRole('textbox')[0]!, '남는 답');
    await user.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    for (const [arg] of saveDraft.mock.calls) {
      expect((arg as { answers: Record<string, unknown> }).answers).not.toHaveProperty('q-gone');
    }
    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ answers: expect.objectContaining({ 'q-keep': '남는 답' }) }),
    );
  });
});
