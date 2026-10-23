import { ORPCError } from '@orpc/client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { Survey } from '@/types/survey';

/**
 * 첫 답 생성이 테스트 버전 재발행 거부(409 TEST_VERSION_REPUBLISHED)를 받으면 안내로 멈춘다.
 *
 * 같은 세션의 옛 테스트 행을 물려받아 첫 답을 머지할 때 그 행의 테스트 버전 스냅샷이 비워져 있으면
 * 생성 경로에서도 이 거부가 온다. 초안 저장·제출은 안내로 접었는데 생성만 콘솔 로그로 삼켜, 응답
 * 행이 없는 채 다음 입력마다 생성을 다시 시도했다.
 */

const {
  stepVisit,
  resume,
  bySlug,
  byPrivateToken,
  forResponse,
  attrsLookup,
  createWithFirstAnswer,
  createBlank,
  saveDraft,
  complete,
  checkOnEntry,
  quotaCheck,
} = vi.hoisted(() => ({
  stepVisit: vi.fn(),
  resume: vi.fn(),
  bySlug: vi.fn(),
  byPrivateToken: vi.fn(),
  forResponse: vi.fn(),
  attrsLookup: vi.fn(),
  createWithFirstAnswer: vi.fn(),
  createBlank: vi.fn(),
  saveDraft: vi.fn(),
  complete: vi.fn(),
  checkOnEntry: vi.fn(),
  quotaCheck: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      publicRead: {
        bySlug: (...args: unknown[]) => bySlug(...args),
        byPrivateToken: (...args: unknown[]) => byPrivateToken(...args),
        forResponse: (...args: unknown[]) => forResponse(...args),
      },
    },
    contacts: { attrs: { lookup: (...args: unknown[]) => attrsLookup(...args) } },
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
    quota: { check: (...args: unknown[]) => quotaCheck(...args) },
  },
}));

const threePageSurvey = {
  id: 'survey-1',
  title: '재발행 안내 검증 설문',
  status: 'published',
  currentVersionId: 'version-1',
  groups: [],
  questions: [
    {
      id: 'q1',
      type: 'text',
      title: '첫 번째 질문',
      description: '',
      required: false,
      order: 0,
      placeholder: '첫 답변',
    },
    {
      id: 'q2',
      type: 'text',
      title: '두 번째 질문',
      description: '',
      required: false,
      order: 1,
      placeholder: '둘째 답변',
      pageBreakBefore: true,
    },
    {
      id: 'q3',
      type: 'text',
      title: '세 번째 질문',
      description: '',
      required: false,
      order: 2,
      placeholder: '셋째 답변',
      pageBreakBefore: true,
    },
  ],
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
  createdAt: new Date('2026-08-21T00:00:00.000Z'),
  updatedAt: new Date('2026-08-21T00:00:00.000Z'),
} as Survey;

beforeEach(() => {
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
  bySlug.mockResolvedValue({ id: 'survey-1' });
  attrsLookup.mockResolvedValue({});
  stepVisit.mockResolvedValue({ ok: true });
  saveDraft.mockResolvedValue({ ok: true, applied: true });
  forResponse.mockResolvedValue({
    survey: threePageSurvey,
    versionId: 'version-1',
    control: {
      isPaused: false,
      pausedMessage: null,
      testSession: null,
      testSessionKind: null,
    },
  });
  createWithFirstAnswer.mockResolvedValue({ kind: 'created', id: 'response-1' });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const mock of [
    stepVisit, resume, bySlug, byPrivateToken, forResponse, attrsLookup,
    createWithFirstAnswer, createBlank, saveDraft, complete, checkOnEntry, quotaCheck,
  ]) {
    mock.mockReset();
  }
});

describe('첫 답 생성 — 테스트 버전 재발행 거부', () => {
  it('409 TEST_VERSION_REPUBLISHED 를 받으면 「설문이 수정되었습니다」 안내로 전환한다', async () => {
    createWithFirstAnswer.mockReset();
    createWithFirstAnswer.mockRejectedValue(
      new ORPCError('TEST_VERSION_REPUBLISHED', { status: 409, message: 'republished' }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <SurveyResponseFlow surveyIdentifier="survey-slug" inviteToken={null} testToken={null} />,
    );

    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: 'v1' },
    });
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));

    expect(await screen.findByText('설문이 수정되었습니다')).toBeInTheDocument();
  });
});
