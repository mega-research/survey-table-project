import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { SurveyControl } from '@/shared/contracts/survey-builder-io';
import type { Survey } from '@/types/survey';

const { forResponse, attrsLookup, resume, checkOnEntry } = vi.hoisted(() => ({
  forResponse: vi.fn(),
  attrsLookup: vi.fn(),
  resume: vi.fn(),
  checkOnEntry: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      publicRead: {
        bySlug: vi.fn(),
        byPrivateToken: vi.fn(),
        forResponse: (...a: unknown[]) => forResponse(...a),
      },
    },
    contacts: {
      attrs: { lookup: (...a: unknown[]) => attrsLookup(...a) },
      priorAnswers: { lookup: vi.fn().mockResolvedValue(null) },
    },
    surveyResponse: {
      lifecycle: {
        stepVisit: vi.fn().mockResolvedValue({ ok: true }),
        resume: (...a: unknown[]) => resume(...a),
      },
      response: {
        createWithFirstAnswer: vi.fn(),
        createBlank: vi.fn(),
        saveDraft: vi.fn(),
        complete: vi.fn(),
      },
      duplicate: { checkOnEntry: (...a: unknown[]) => checkOnEntry(...a) },
    },
    quota: { check: vi.fn() },
  },
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  // 세그먼트 신호(sendBeacon/fetch)는 이 파일의 관심사가 아니다.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});

const SURVEY_ID = 'survey-1';
const INVITE = '11111111-1111-4111-8111-111111111111';
const NOT_ACCEPTING = '지금은 응답을 받고 있지 않습니다';

const survey = {
  id: SURVEY_ID,
  title: '종료된 설문',
  status: 'closed',
  currentVersionId: 'version-1',
  groups: [],
  questions: [
    { id: 'q1', type: 'text', title: '질문', description: '', required: false, order: 0, placeholder: '답변' },
  ],
  settings: {
    isPublic: true,
    allowMultipleResponses: false,
    showProgressBar: true,
    shuffleQuestions: false,
    requireLogin: false,
    thankYouMessage: '감사합니다.',
    requireInviteToken: false,
  },
  lookups: [],
  createdAt: new Date('2026-08-24T00:00:00.000Z'),
  updatedAt: new Date('2026-08-24T00:00:00.000Z'),
} as unknown as Survey;

function control(over: Partial<SurveyControl>): SurveyControl {
  return {
    isPaused: false,
    pausedMessage: null,
    isClosed: true,
    resumableByInvite: null,
    testSession: 'none',
    testSessionKind: null,
    priorWaveLabel: null,
    changeConfirmEnabled: false,
    endRedirects: null,
    ...over,
  };
}

function renderFlow(over: Partial<SurveyControl>, inviteToken: string | null) {
  forResponse.mockResolvedValue({
    survey,
    versionId: 'version-1',
    documentView: null,
    control: control(over),
  });
  return render(
    <SurveyResponseFlow
      surveyIdentifier={SURVEY_ID}
      resolvedSurveyId={SURVEY_ID}
      inviteToken={inviteToken}
      testToken={null}
    />,
  );
}

/** 서버가 돌려주는 진행 중 응답 — 답 하나를 써 둔 상태다. */
const inProgressRow = {
  id: 'response-1',
  status: 'in_progress',
  resumed: false,
  questionResponses: { q1: '쓰던 답' },
  currentStepId: null,
  draftSeq: 0,
};

/**
 * 종료된 설문의 첫 화면 (ADR-0030).
 *
 * 종료는 **새 응답만** 닫는다. 그래서 첫 화면이 지켜야 할 것이 둘이다 — 처음 온 사람은 첫
 * 문항을 답한 뒤가 아니라 **들어오자마자** 안내를 보고, 응답하던 사람은 **쓰던 답과 함께**
 * 이어간다. 한쪽만 맞으면 다른 쪽이 조용히 깨진다: 전부 막으면 진행 중 응답이 몰수되고,
 * 전부 통과시키면 첫 답변에서야 막힌다.
 */
describe('종료된 설문의 첫 화면', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSurveyResponseStore.getState().resetResponseState();
    attrsLookup.mockResolvedValue({});
    resume.mockResolvedValue(null);
    checkOnEntry.mockResolvedValue({ blocked: false });
  });

  afterEach(() => vi.clearAllMocks());

  it('초대 링크로 처음 온 대상은 문항을 보기 전에 안내를 본다', async () => {
    renderFlow({ resumableByInvite: false }, INVITE);

    expect(await screen.findByText(NOT_ACCEPTING)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('답변')).not.toBeInTheDocument();
  });

  it('초대 링크의 대상이 응답하던 중이었으면 쓰던 답과 함께 이어간다', async () => {
    resume.mockResolvedValue(inProgressRow);
    renderFlow({ resumableByInvite: true }, INVITE);

    await waitFor(() => expect(screen.getByPlaceholderText('답변')).toHaveValue('쓰던 답'));
    expect(screen.queryByText(NOT_ACCEPTING)).not.toBeInTheDocument();
  });

  it('공개 링크로 처음 온 방문자도 문항을 보기 전에 안내를 본다', async () => {
    renderFlow({}, null);

    expect(await screen.findByText(NOT_ACCEPTING)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('답변')).not.toBeInTheDocument();
  });

  it('이 브라우저에서 응답하던 방문자는 쓰던 답과 함께 이어간다', async () => {
    window.localStorage.setItem(`survey-session:${SURVEY_ID}`, 'session-saved');
    resume.mockResolvedValue(inProgressRow);
    renderFlow({}, null);

    await waitFor(() => expect(screen.getByPlaceholderText('답변')).toHaveValue('쓰던 답'));
    expect(screen.queryByText(NOT_ACCEPTING)).not.toBeInTheDocument();
  });

  it('세션은 남았는데 이어갈 응답이 없으면 회복이 끝난 뒤 안내로 바뀐다', async () => {
    // 지난번 응답을 이미 제출했거나 응답 행이 지워진 브라우저 — 종료된 설문에서 새로 시작할
    // 수는 없으므로, 문항을 보여 주고 첫 답변에서 막는 대신 여기서 알린다.
    window.localStorage.setItem(`survey-session:${SURVEY_ID}`, 'session-orphan');
    resume.mockResolvedValue(null);
    renderFlow({}, null);

    expect(await screen.findByText(NOT_ACCEPTING)).toBeInTheDocument();
  });

  it('종료되지 않은 설문은 처음 온 방문자에게 문항을 보여 준다', async () => {
    renderFlow({ isClosed: false }, null);

    expect(await screen.findByPlaceholderText('답변')).toBeInTheDocument();
    expect(screen.queryByText(NOT_ACCEPTING)).not.toBeInTheDocument();
  });
});
