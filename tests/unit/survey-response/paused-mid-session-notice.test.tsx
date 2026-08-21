import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/question-renderer/stores/survey-response-store';
import type { Survey } from '@/types/survey';

/**
 * 세션 도중 중단 감지 갭 회귀 테스트 (GAP-1).
 *
 * 중단 차단은 답변 저장(flush)이 실패해야 감지된다. 그런데 flush 는 pending 이 비어 있으면
 * 왕복 없이 즉시 반환하므로, 아무것도 입력하지 않고 "다음" 을 누르는 스텝에서는 중단을
 * 감지하지 못하고 계속 진행된다 — 공지형 스텝, 뒤로 갔다가 그대로 다음, 전부 건너뛴 선택 문항.
 *
 * stepVisit 은 그 전환에서도 발사되므로 그 응답에 실린 판정으로 갭을 메운다.
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
  title: '중단 감지 갭 검증 설문',
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

describe('세션 도중 중단 감지 — 저장할 답변이 없는 전환', () => {
  it('아무것도 입력하지 않고 다음을 눌러도 중단을 감지해 안내로 전환한다', async () => {
    render(
      <SurveyResponseFlow surveyIdentifier="survey-slug" inviteToken={null} testToken={null} />,
    );

    // 1페이지: 답변 후 다음 → flush 1회(여기까지는 현행도 중단을 감지할 수 있는 경로)
    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: 'v1' },
    });
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();

    // 여기서 운영자가 설문을 중단한다.
    stepVisit.mockResolvedValue({
      ok: true,
      denial: 'survey_paused',
      pausedMessage: '점검 중입니다',
    });

    // 2페이지: 아무것도 건드리지 않고 다음 — pending 이 비어 flush 가 왕복하지 않는다.
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    // 갭 조건 재현 확인: 이 전환은 저장 왕복을 만들지 않는다.
    await waitFor(() => expect(stepVisit).toHaveBeenCalled());
    expect(saveDraft).toHaveBeenCalledTimes(1);

    // stepVisit 응답에 실린 판정으로 차단 화면으로 전환된다.
    expect(await screen.findByText('점검 중입니다')).toBeInTheDocument();
    expect(screen.queryByText('세 번째 질문')).not.toBeInTheDocument();
  });

  it('stepVisit 이 실패하면 응답자를 막지 않는다 — 429 포함 fail-open', async () => {
    render(
      <SurveyResponseFlow surveyIdentifier="survey-slug" inviteToken={null} testToken={null} />,
    );

    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: 'v1' },
    });
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();

    // 레이트리밋·네트워크 실패는 판정을 알 수 없다는 뜻이지 차단이 아니다.
    stepVisit.mockRejectedValue(new Error('TOO_MANY_REQUESTS'));
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    expect(await screen.findByText('세 번째 질문')).toBeInTheDocument();
  });

  it('판정이 없는 응답은 무시한다 — 구버전 서버 호환', async () => {
    render(
      <SurveyResponseFlow surveyIdentifier="survey-slug" inviteToken={null} testToken={null} />,
    );

    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: 'v1' },
    });
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();

    // 필드를 모르는 구버전 서버는 { ok: true } 만 돌려준다.
    stepVisit.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    expect(await screen.findByText('세 번째 질문')).toBeInTheDocument();
  });
});
