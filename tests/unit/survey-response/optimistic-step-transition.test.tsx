import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Survey } from '@/types/survey';

/**
 * "다음" 클릭 낙관 전환 회귀 테스트.
 *
 * 답변 입력 후 5초 디바운스 안에 "다음"을 누르는 것이 응답자의 지배적 패턴이라,
 * 전환이 saveDraft 왕복(로컬 dev 실측 270~550ms)을 기다리면 매 스텝이 그만큼 느리다.
 * 체크포인트 저장은 fire-and-forget 으로 계속 나가되(실패 시 pending 유지 - 다음
 * flush/beacon/complete 안전망에 합류), 화면 전환은 저장 완료를 기다리지 않는다.
 * 서버 seq 가드 + enqueueFlush 직렬화 체인이 순서/중복을 방어한다.
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('다음 클릭 낙관 전환', () => {
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
    attrsLookup.mockResolvedValue({});
    stepVisit.mockResolvedValue(undefined);
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

  it('전환은 saveDraft 완료를 기다리지 않고, 저장은 백그라운드로 완주한다', async () => {
    const draftSave = deferred<{ ok: boolean; applied: boolean }>();
    saveDraft.mockReturnValue(draftSave.promise);

    render(
      <SurveyResponseFlow surveyIdentifier="survey-slug" inviteToken={null} testToken={null} />,
    );

    // 1페이지: 첫 답변 입력 → 응답 행 생성 완료까지 대기
    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: 'v1' },
    });
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));

    // 값 수정으로 pending 을 남긴 상태에서 "다음" — 디바운스(5초) 발사 전이므로
    // flush 가 saveDraft 를 태우게 된다
    fireEvent.change(screen.getByPlaceholderText('첫 답변'), {
      target: { value: 'v2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    // 핵심 단언: saveDraft 가 아직 미해결인데도 2페이지가 렌더된다 (낙관 전환)
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ responseId: 'response-1', answers: expect.objectContaining({ q1: 'v2' }) }),
    );

    // 백그라운드 저장 완주 — 에러 없이 마무리
    await act(async () => {
      draftSave.resolve({ ok: true, applied: true });
      await draftSave.promise;
    });
  });

  it('체크포인트 실패는 조용히 pending 을 유지하고 다음 flush 에 합류한다', async () => {
    const firstSave = deferred<{ ok: boolean; applied: boolean }>();
    saveDraft.mockReturnValueOnce(firstSave.promise);
    saveDraft.mockResolvedValue({ ok: true, applied: true });

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

    // 낙관 전환으로 2페이지 진입
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();

    // 첫 체크포인트가 네트워크 오류로 실패 — 전환은 이미 끝났고 토스트도 없다
    await act(async () => {
      firstSave.reject(new Error('network down'));
      await firstSave.promise.catch(() => {});
    });

    // 2페이지(마지막 스텝)의 "다음" = 제출 경로 — complete 가 전체 답을 일괄 저장한다.
    // (제출 버튼 라벨도 '다음'으로 통일되어 있다 — 2026-08-12 결정)
    complete.mockResolvedValue({ ok: true });
    fireEvent.change(screen.getByPlaceholderText('둘째 답변'), {
      target: { value: 'v3' },
    });
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    // 실패한 v2 는 pending 에 남아 complete 페이로드에 합류한다
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: 'response-1',
        data: expect.objectContaining({
          questionResponses: expect.objectContaining({ q1: 'v2', q2: 'v3' }),
        }),
      }),
    );
  });
});
