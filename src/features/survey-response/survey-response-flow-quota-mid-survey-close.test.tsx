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
