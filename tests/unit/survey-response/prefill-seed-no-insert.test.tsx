import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { Survey } from '@/types/survey';

const { stepVisit, resume, bySlug, forResponse, attrsLookup, createWithFirstAnswer, saveDraft, complete, checkOnEntry } =
  vi.hoisted(() => ({
    stepVisit: vi.fn(),
    resume: vi.fn(),
    bySlug: vi.fn(),
    forResponse: vi.fn(),
    attrsLookup: vi.fn(),
    createWithFirstAnswer: vi.fn(),
    saveDraft: vi.fn(),
    complete: vi.fn(),
    checkOnEntry: vi.fn(),
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
    contacts: { attrs: { lookup: (...a: unknown[]) => attrsLookup(...a) } },
    surveyResponse: {
      lifecycle: {
        stepVisit: (...a: unknown[]) => stepVisit(...a),
        resume: (...a: unknown[]) => resume(...a),
      },
      response: {
        createWithFirstAnswer: (...a: unknown[]) => createWithFirstAnswer(...a),
        createBlank: vi.fn(),
        saveDraft: (...a: unknown[]) => saveDraft(...a),
        complete: (...a: unknown[]) => complete(...a),
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
});

/**
 * prefill 은 마운트 직후 스스로 한 번 쓴다. 그 쓰기가 응답 행 INSERT 를 발사하면
 * 링크를 열기만 해도 진행 중 응답이 생겨 진척·이탈 통계가 왜곡된다.
 * 값 자체는 pending 에 남아 실제 첫 답변에 합쳐지므로 유실되지 않는다.
 */
const prefillSurvey = {
  id: 'survey-1',
  title: 'prefill 설문',
  status: 'published',
  currentVersionId: 'version-1',
  groups: [],
  questions: [
    {
      id: 'q-prefill',
      type: 'text',
      title: '회사',
      description: '',
      required: false,
      order: 0,
      placeholder: '회사명',
      defaultValueTemplate: '{{회사}}',
    },
    {
      id: 'q-free',
      type: 'text',
      title: '자유 입력',
      description: '',
      required: false,
      order: 1,
      placeholder: '자유 답변',
    },
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

describe('prefill 은 응답 행을 만들지 않는다', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSurveyResponseStore.getState().resetResponseState();
    bySlug.mockResolvedValue({ id: 'survey-1' });
    forResponse.mockResolvedValue({
      survey: prefillSurvey,
      versionId: 'version-1',
      control: { isPaused: false, pausedMessage: null, testSession: 'none', testSessionKind: null },
    });
    attrsLookup.mockResolvedValue({ 회사: '메가리서치' });
    resume.mockResolvedValue(null);
    checkOnEntry.mockResolvedValue({ blocked: false });
    stepVisit.mockResolvedValue(undefined);
    createWithFirstAnswer.mockResolvedValue({
      kind: 'created',
      id: 'response-1',
      contactTargetId: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prefill 이 채워져도 응답자가 답하기 전에는 행을 만들지 않는다', async () => {
    render(
      <SurveyResponseFlow
        surveyIdentifier="prefill-survey"
        inviteToken="11111111-1111-4111-8111-111111111111"
        testToken={null}
      />,
    );

    // prefill 이 실제로 채워진 뒤에 판정해야 의미가 있다.
    expect(await screen.findByDisplayValue('메가리서치')).toBeInTheDocument();
    await waitFor(() => expect(attrsLookup).toHaveBeenCalled());

    expect(createWithFirstAnswer).not.toHaveBeenCalled();
  });

  it('응답자가 실제로 답하면 그때 행을 만든다', async () => {
    render(
      <SurveyResponseFlow
        surveyIdentifier="prefill-survey"
        inviteToken="11111111-1111-4111-8111-111111111111"
        testToken={null}
      />,
    );
    expect(await screen.findByDisplayValue('메가리서치')).toBeInTheDocument();
    expect(createWithFirstAnswer).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('자유 답변'), { target: { value: '실제 답변' } });

    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
    expect(createWithFirstAnswer.mock.calls[0]?.[0]).toMatchObject({
      questionId: 'q-free',
      value: '실제 답변',
    });
  });
});
