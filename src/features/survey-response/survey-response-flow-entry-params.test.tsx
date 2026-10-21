import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { SurveyEndRedirects } from '@/shared/contracts/survey';
import type { Survey } from '@/types/survey';

/**
 * 이어 넘길 값 (패널 연동, CONTEXT.md 「종료 후 이동 주소」).
 * 링크에 붙어 온 설정된 이름의 값(리멤버 `?euid=`)을 응답 행 생성 요청에 싣고 종료 주소에 붙인다.
 */

const { bySlug, forResponse, attrsLookup, stepVisit, createWithFirstAnswer, saveDraft, complete } =
  vi.hoisted(() => ({
    bySlug: vi.fn(),
    forResponse: vi.fn(),
    attrsLookup: vi.fn(),
    stepVisit: vi.fn(),
    createWithFirstAnswer: vi.fn(),
    saveDraft: vi.fn(),
    complete: vi.fn(),
  }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      publicRead: {
        bySlug: (...a: unknown[]) => bySlug(...a),
        byPrivateToken: vi.fn(),
        forResponse: (...a: unknown[]) => forResponse(...a),
      },
    },
    contacts: {
      attrs: { lookup: (...a: unknown[]) => attrsLookup(...a) },
      priorAnswers: { lookup: async () => null },
    },
    surveyResponse: {
      lifecycle: { stepVisit: (...a: unknown[]) => stepVisit(...a), resume: vi.fn() },
      response: {
        createWithFirstAnswer: (...a: unknown[]) => createWithFirstAnswer(...a),
        createBlank: vi.fn(),
        saveDraft: (...a: unknown[]) => saveDraft(...a),
        complete: (...a: unknown[]) => complete(...a),
      },
      duplicate: { checkOnEntry: vi.fn().mockResolvedValue({ blocked: false }) },
    },
    quota: { check: vi.fn() },
  },
}));

const survey = {
  id: 'survey-1',
  title: '패널 설문',
  status: 'published',
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
  createdAt: new Date('2026-10-21T00:00:00.000Z'),
  updatedAt: new Date('2026-10-21T00:00:00.000Z'),
} as unknown as Survey;

function mockSurvey(endRedirects: SurveyEndRedirects | null) {
  forResponse.mockResolvedValue({
    survey,
    versionId: 'version-1',
    control: {
      isPaused: false,
      pausedMessage: null,
      testSession: 'none',
      testSessionKind: null,
      priorWaveLabel: null,
      changeConfirmEnabled: false,
      endRedirects,
    },
  });
}

function renderFlow(entryQuery: string) {
  return render(
    <SurveyResponseFlow
      surveyIdentifier="panel-survey"
      inviteToken={null}
      testToken={null}
      entryQuery={entryQuery}
    />,
  );
}

async function answer() {
  fireEvent.change(await screen.findByPlaceholderText('답변'), { target: { value: 'v1' } });
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
  complete.mockResolvedValue({ id: 'response-1', status: 'completed' });
});

afterEach(() => {
  for (const mock of [bySlug, forResponse, attrsLookup, stepVisit, createWithFirstAnswer, saveDraft, complete]) {
    mock.mockReset();
  }
});

describe('이어 넘길 값', () => {
  it('설정된 이름의 값만 응답 행 생성 요청에 싣는다', async () => {
    mockSurvey({ completed: 'https://tally.so/r/rDyxNl', passParams: ['euid'] });
    renderFlow('euid=12345&utm=x');
    await answer();
    expect(createWithFirstAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ entryParams: { euid: '12345' } }),
    );
  });

  it('완료되면 종료 주소 뒤에 값을 붙여 보낸다', async () => {
    mockSurvey({ completed: 'https://tally.so/r/rDyxNl', passParams: ['euid'] });
    renderFlow('euid=12345');
    await answer();
    fireEvent.click(screen.getByRole('button', { name: /제출|다음/ }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    const link = await screen.findByRole('link', { name: '여기를 눌러 주세요' });
    expect(link).toHaveAttribute('href', 'https://tally.so/r/rDyxNl?euid=12345');
  });

  it('설정이 없으면 링크에 값이 있어도 싣지 않는다', async () => {
    mockSurvey({ completed: 'https://tally.so/r/rDyxNl' });
    renderFlow('euid=12345');
    await answer();
    expect(createWithFirstAnswer.mock.calls[0]?.[0]).not.toHaveProperty('entryParams');
  });
});
