import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { QuotaGate } from '@/shared/contracts/quota';
import type { Survey } from '@/types/survey';

/**
 * 쿼터 「진행 중 마감」 — 응답 화면 (ADR 0025).
 *
 * - 제출 결과가 quota_closed 면 완료 화면 대신 기존 쿼터 마감 화면에 진행 중 마감 문구를 띄운다.
 * - 게이트에 재확인 표식이 있으면 첫 판정 이후의 「다음」마다 확인을 백그라운드로 다시 보내고,
 *   전환은 기다리지 않으며, blocked 면 마감 화면으로 갈아 끼운다. 표식이 없으면 종전대로 1회.
 */

const {
  stepVisit,
  resume,
  bySlug,
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
        byPrivateToken: vi.fn(),
        forResponse: (...args: unknown[]) => forResponse(...args),
      },
    },
    contacts: {
      attrs: { lookup: (...args: unknown[]) => attrsLookup(...args) },
      priorAnswers: { lookup: async () => null },
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
    quota: { check: (...args: unknown[]) => quotaCheck(...args) },
  },
}));

const QUOTA_CLOSED_DEFAULT = '해당 조건의 모집이 완료되어 더 이상 참여하실 수 없습니다.';
const MID_SURVEY_DEFAULT = '응답 중에 해당 조건의 모집이 완료되어';

function threePageSurvey(quotaGate: QuotaGate): Survey {
  return {
    id: 'survey-1',
    title: '진행 중 마감 설문',
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
    quotaGate,
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
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    updatedAt: new Date('2026-09-23T00:00:00.000Z'),
  } as Survey;
}

function mockSurvey(gate: QuotaGate) {
  forResponse.mockResolvedValue({
    survey: threePageSurvey(gate),
    versionId: 'version-1',
    control: { isPaused: false, pausedMessage: null, testSession: null, testSessionKind: null },
  });
}

function renderFlow() {
  return render(
    <SurveyResponseFlow surveyIdentifier="survey-slug" inviteToken={null} testToken={null} />,
  );
}

/** 첫 페이지에 답하고 응답 행이 만들어질 때까지 기다린다. */
async function answerFirstPage() {
  fireEvent.change(await screen.findByPlaceholderText('첫 답변'), { target: { value: 'v1' } });
  await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
  window.localStorage.clear();
  useSurveyResponseStore.getState().resetResponseState();
  bySlug.mockResolvedValue({ id: 'survey-1' });
  attrsLookup.mockResolvedValue({});
  stepVisit.mockResolvedValue(undefined);
  saveDraft.mockResolvedValue({ ok: true, applied: true });
  createWithFirstAnswer.mockResolvedValue({ kind: 'created', id: 'response-1' });
  quotaCheck.mockResolvedValue({ blocked: false, closedMessage: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const mock of [
    stepVisit, resume, bySlug, forResponse, attrsLookup,
    createWithFirstAnswer, createBlank, saveDraft, complete, checkOnEntry, quotaCheck,
  ]) {
    mock.mockReset();
  }
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('페이지마다 백그라운드 재확인', () => {
  it('표식이 있으면 두 번째 「다음」에서도 확인이 나가고 전환은 기다리지 않으며, blocked 면 진행 중 마감 문구로 교체한다', async () => {
    mockSurvey({ questionIds: ['q1'], recheckOnEachStep: true });
    const recheck = deferred<{ blocked: boolean; closedMessage: string | null; midSurveyClosedMessage?: string | null }>();
    quotaCheck
      .mockResolvedValueOnce({ blocked: false, closedMessage: null })
      .mockImplementationOnce(() => recheck.promise);
    renderFlow();
    await answerFirstPage();

    // 첫 판정 — 기다렸다가 전환.
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();
    expect(quotaCheck).toHaveBeenCalledTimes(1);

    // 재확인 — 결과가 오기 전에 이미 다음 쪽이 열려 있다(낙관 전환 유지).
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('세 번째 질문')).toBeInTheDocument();
    expect(quotaCheck).toHaveBeenCalledTimes(2);

    recheck.resolve({
      blocked: true,
      closedMessage: '입장 마감 문구',
      midSurveyClosedMessage: '죄송합니다. 응답 중 마감되었습니다.',
    });
    expect(await screen.findByText('죄송합니다. 응답 중 마감되었습니다.')).toBeInTheDocument();
    expect(screen.queryByText('입장 마감 문구')).not.toBeInTheDocument();
    expect(screen.queryByText('세 번째 질문')).not.toBeInTheDocument();
  });

  it('표식이 없으면 종전대로 응답당 1회만 확인한다', async () => {
    mockSurvey({ questionIds: ['q1'] });
    renderFlow();
    await answerFirstPage();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('세 번째 질문')).toBeInTheDocument();

    expect(quotaCheck).toHaveBeenCalledTimes(1);
  });

  it('첫 판정에서 막히면 기존 마감 문구를 보인다', async () => {
    mockSurvey({ questionIds: ['q1'], recheckOnEachStep: true });
    quotaCheck.mockResolvedValueOnce({
      blocked: true,
      closedMessage: '입장 마감 문구',
      midSurveyClosedMessage: '죄송합니다',
    });
    renderFlow();
    await answerFirstPage();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    expect(await screen.findByText('입장 마감 문구')).toBeInTheDocument();
    expect(screen.queryByText('죄송합니다')).not.toBeInTheDocument();
  });

  it('재확인 결과가 blocked 인데 문구가 비면 사과 톤 기본 문구로 폴백한다', async () => {
    mockSurvey({ questionIds: ['q1'], recheckOnEachStep: true });
    quotaCheck
      .mockResolvedValueOnce({ blocked: false, closedMessage: null })
      .mockResolvedValueOnce({ blocked: true, closedMessage: null, midSurveyClosedMessage: null });
    renderFlow();
    await answerFirstPage();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    expect(await screen.findByText(new RegExp(MID_SURVEY_DEFAULT))).toBeInTheDocument();
  });

  it('재확인이 실패하면 통과한다(fail-open) — 제출 시점 서버 판정이 최종 방어다', async () => {
    mockSurvey({ questionIds: ['q1'], recheckOnEachStep: true });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    quotaCheck
      .mockResolvedValueOnce({ blocked: false, closedMessage: null })
      .mockRejectedValueOnce(new Error('429'));
    renderFlow();
    await answerFirstPage();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('세 번째 질문')).toBeInTheDocument();

    await waitFor(() => expect(quotaCheck).toHaveBeenCalledTimes(2));
    expect(screen.getByText('세 번째 질문')).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('되돌아가 쿼터 문항의 답을 바꾸면 다음 「다음」부터 새 답으로 판정한다', async () => {
    mockSurvey({ questionIds: ['q1'], recheckOnEachStep: true });
    renderFlow();
    await answerFirstPage();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();
    expect(quotaCheck).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '이전' }));
    expect(await screen.findByPlaceholderText('첫 답변')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('첫 답변'), { target: { value: 'v2' } });
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();

    await waitFor(() => expect(quotaCheck).toHaveBeenCalledTimes(2));
    const lastCall = quotaCheck.mock.calls[1]![0] as { answers: Record<string, unknown> };
    expect(lastCall.answers['q1']).toBe('v2');
  });

  it('마지막 「제출」에서는 재확인을 따로 보내지 않는다 — 제출 자체가 판정을 받는다', async () => {
    mockSurvey({ questionIds: ['q1'], recheckOnEachStep: true });
    complete.mockResolvedValue({ id: 'response-1', status: 'completed' });
    renderFlow();
    await answerFirstPage();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('세 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('감사합니다.')).toBeInTheDocument();
    // 첫 판정 1회 + 2→3 쪽 재확인 1회. 제출 클릭에서는 안 나간다.
    expect(quotaCheck).toHaveBeenCalledTimes(2);
  });
});

describe('늦은 재확인 결과와 테스트 세션', () => {
  it('제출 뒤에 도착한 blocked 재확인은 버린다 — 완료 화면이 마감 화면으로 바뀌지 않는다', async () => {
    mockSurvey({ questionIds: ['q1'], recheckOnEachStep: true });
    const late = deferred<{ blocked: boolean; closedMessage: string | null; midSurveyClosedMessage?: string | null }>();
    quotaCheck
      .mockResolvedValueOnce({ blocked: false, closedMessage: null })
      .mockImplementationOnce(() => late.promise);
    complete.mockResolvedValue({ id: 'response-1', status: 'completed' });
    renderFlow();
    await answerFirstPage();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('세 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('감사합니다.')).toBeInTheDocument();

    late.resolve({ blocked: true, closedMessage: null, midSurveyClosedMessage: '죄송합니다' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('감사합니다.')).toBeInTheDocument();
    expect(screen.queryByText('죄송합니다')).not.toBeInTheDocument();
  });

  it('테스트 세션은 재확인을 보내지 않는다', async () => {
    forResponse.mockResolvedValue({
      survey: threePageSurvey({ questionIds: ['q1'], recheckOnEachStep: true }),
      versionId: 'version-1',
      control: { isPaused: false, pausedMessage: null, testSession: 'valid', testSessionKind: 'anonymous' },
    });
    render(
      <SurveyResponseFlow surveyIdentifier="survey-slug" inviteToken={null} testToken="tok" />,
    );
    await answerFirstPage();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('세 번째 질문')).toBeInTheDocument();

    // 첫 판정 1회뿐 — 재확인은 없다.
    expect(quotaCheck).toHaveBeenCalledTimes(1);
  });
});

describe('제출 시점 쿼터마감', () => {
  it('제출 결과가 quota_closed 면 완료 화면 대신 진행 중 마감 문구로 마감 화면을 띄운다', async () => {
    mockSurvey({ questionIds: ['q1'], recheckOnEachStep: true });
    complete.mockResolvedValue({
      kind: 'quota_closed',
      closedMessage: '죄송합니다. 응답 중 마감되었습니다.',
    });
    renderFlow();
    await answerFirstPage();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('세 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('죄송합니다. 응답 중 마감되었습니다.')).toBeInTheDocument();
    expect(screen.queryByText('감사합니다.')).not.toBeInTheDocument();
    expect(screen.queryByText('응답 완료!')).not.toBeInTheDocument();
  });

  it('서버 문구가 null 이면 사과 톤 기본 문구로 폴백한다', async () => {
    mockSurvey({ questionIds: ['q1'] });
    complete.mockResolvedValue({ kind: 'quota_closed', closedMessage: null });
    renderFlow();
    await answerFirstPage();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('두 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('세 번째 질문')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(new RegExp(MID_SURVEY_DEFAULT))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(QUOTA_CLOSED_DEFAULT))).not.toBeInTheDocument();
  });
});
