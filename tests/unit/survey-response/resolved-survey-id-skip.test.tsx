import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { Survey } from '@/types/survey';

const { bySlug, byPrivateToken, forResponse, attrsLookup, resume, checkOnEntry } = vi.hoisted(
  () => ({
    bySlug: vi.fn(),
    byPrivateToken: vi.fn(),
    forResponse: vi.fn(),
    attrsLookup: vi.fn(),
    resume: vi.fn(),
    checkOnEntry: vi.fn(),
  }),
);

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      publicRead: {
        bySlug: (...a: unknown[]) => bySlug(...a),
        byPrivateToken: (...a: unknown[]) => byPrivateToken(...a),
        forResponse: (...a: unknown[]) => forResponse(...a),
      },
    },
    contacts: { attrs: { lookup: (...a: unknown[]) => attrsLookup(...a) } },
    surveyResponse: {
      lifecycle: { stepVisit: vi.fn(), resume: (...a: unknown[]) => resume(...a) },
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
});

const survey = {
  id: 'survey-1',
  title: '설문',
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
  createdAt: new Date('2026-08-24T00:00:00.000Z'),
  updatedAt: new Date('2026-08-24T00:00:00.000Z'),
} as unknown as Survey;

/**
 * 짧은 초대 링크(/i/<code>)의 서버 컴포넌트는 초대 코드를 풀면서 설문 id 를 이미 조회한다.
 * 그것을 넘겨받으면 클라이언트가 같은 답을 다시 묻는 왕복이 사라진다.
 */
describe('resolvedSurveyId 가 있으면 식별자 조회 왕복이 없다', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSurveyResponseStore.getState().resetResponseState();
    forResponse.mockResolvedValue({
      survey,
      versionId: 'version-1',
      control: { isPaused: false, pausedMessage: null, testSession: 'none', testSessionKind: null },
    });
    attrsLookup.mockResolvedValue({});
    resume.mockResolvedValue(null);
    checkOnEntry.mockResolvedValue({ blocked: false });
    bySlug.mockResolvedValue({ id: 'survey-1' });
    byPrivateToken.mockResolvedValue({ id: 'survey-1' });
  });

  afterEach(() => vi.clearAllMocks());

  it('서버가 풀어 준 설문 id 를 받으면 bySlug 를 부르지 않는다', async () => {
    render(
      <SurveyResponseFlow
        surveyIdentifier="my-survey-slug"
        resolvedSurveyId="survey-1"
        inviteToken="11111111-1111-4111-8111-111111111111"
        testToken={null}
      />,
    );

    expect(await screen.findByPlaceholderText('답변')).toBeInTheDocument();
    expect(bySlug).not.toHaveBeenCalled();
    expect(byPrivateToken).not.toHaveBeenCalled();
    // 설문 조회는 그대로 — 건너뛴 것은 식별자 해석뿐이다.
    expect(forResponse).toHaveBeenCalledWith(expect.objectContaining({ surveyId: 'survey-1' }));
  });

  it('받지 못하면 종전대로 식별자를 먼저 조회한다', async () => {
    render(
      <SurveyResponseFlow surveyIdentifier="my-survey-slug" inviteToken={null} testToken={null} />,
    );

    expect(await screen.findByPlaceholderText('답변')).toBeInTheDocument();
    await waitFor(() => expect(bySlug).toHaveBeenCalledWith({ slug: 'my-survey-slug' }));
    expect(forResponse).toHaveBeenCalledWith(expect.objectContaining({ surveyId: 'survey-1' }));
  });
});
