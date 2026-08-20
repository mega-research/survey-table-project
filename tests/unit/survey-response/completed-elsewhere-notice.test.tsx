import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Survey } from '@/types/survey';

/**
 * "이미 완료된 설문입니다" 안내 회귀 테스트 (동시 세션 정책 G1 의 유일한 구현 항목).
 *
 * 다른 화면이 먼저 complete 한 응답의 잔여 화면은 이전까지 저장이 조용히 실패하며
 * 끝까지 진행됐고, 마지막 제출은 멱등 반환으로 가짜 성공 화면까지 봤다. 서버가
 * 완료-후 쓰기를 concluded/alreadyCompleted 로 신호하면 클라이언트는 안내 화면으로
 * 전환한다. (본인 제출 후 네트워크 재시도 케이스도 같은 안내 문구가 자연스럽게 커버)
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
    contacts: {
      attrs: {
        lookup: (...args: unknown[]) => attrsLookup(...args),
      },
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
      duplicate: {
        checkOnEntry: (...args: unknown[]) => checkOnEntry(...args),
      },
    },
    quota: { check: (...args: unknown[]) => quotaCheck(...args) },
  },
}));

const twoPageSurvey = {
  id: 'survey-1',
  title: '낙관 전환 검증 설문',
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
  createdAt: new Date('2026-08-20T00:00:00.000Z'),
  updatedAt: new Date('2026-08-20T00:00:00.000Z'),
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
  stepVisit.mockResolvedValue(undefined);
  forResponse.mockResolvedValue({
    survey: twoPageSurvey,
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

describe('완료된 응답의 잔여 화면 안내', () => {
  it('flush 가 concluded 신호를 받으면 안내 화면으로 전환한다', async () => {
    // 다른 화면이 이미 complete 한 상태의 잔여 탭 — 저장이 concluded 로 거부된다
    saveDraft.mockResolvedValue({ ok: true, applied: false, concluded: true });

    render(
      <SurveyResponseFlow surveyIdentifier="survey-slug" inviteToken={null} testToken={null} />,
    );

    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: 'v1' },
    });
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('첫 답변'), {
      target: { value: 'v2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    // 조용한 실패로 계속 진행하는 대신 안내 화면으로 전환된다
    expect(
      await screen.findByRole('heading', { name: '이미 완료된 설문입니다' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('두 번째 질문')).not.toBeInTheDocument();
  });

  it('늦은 complete 의 멱등 성공(alreadyCompleted)은 가짜 감사 화면 대신 안내로 전환한다', async () => {
    saveDraft.mockResolvedValue({ ok: true, applied: true });
    complete.mockResolvedValue({ id: 'response-1', alreadyCompleted: true });

    render(
      <SurveyResponseFlow surveyIdentifier="survey-slug" inviteToken={null} testToken={null} />,
    );

    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: 'v1' },
    });
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('둘째 답변'), {
      target: { value: 'v3' },
    });
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole('heading', { name: '이미 완료된 설문입니다' }),
    ).toBeInTheDocument();
    // 본인 정상 완료의 감사 화면이 아니어야 한다
    expect(screen.queryByText('감사합니다.')).not.toBeInTheDocument();
  });
});
