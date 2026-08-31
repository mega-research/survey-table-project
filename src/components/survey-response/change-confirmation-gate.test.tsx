import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question, Survey } from '@/types/survey';

const {
  forResponse,
  attrsLookup,
  priorAnswersLookup,
  resume,
  stepVisit,
  createWithFirstAnswer,
  saveDraft,
  checkOnEntry,
} = vi.hoisted(() => ({
  forResponse: vi.fn(),
  attrsLookup: vi.fn(),
  priorAnswersLookup: vi.fn(),
  resume: vi.fn(),
  stepVisit: vi.fn(),
  createWithFirstAnswer: vi.fn(),
  saveDraft: vi.fn(),
  checkOnEntry: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      publicRead: {
        bySlug: vi.fn(),
        byPrivateToken: vi.fn(async () => null),
        forResponse: (...args: unknown[]) => forResponse(...args),
      },
    },
    contacts: {
      attrs: { lookup: (...args: unknown[]) => attrsLookup(...args) },
      priorAnswers: { lookup: (...args: unknown[]) => priorAnswersLookup(...args) },
    },
    surveyResponse: {
      lifecycle: {
        stepVisit: (...args: unknown[]) => stepVisit(...args),
        resume: (...args: unknown[]) => resume(...args),
      },
      response: {
        createWithFirstAnswer: (...args: unknown[]) => createWithFirstAnswer(...args),
        createBlank: vi.fn(),
        saveDraft: (...args: unknown[]) => saveDraft(...args),
        complete: vi.fn(),
      },
      duplicate: { checkOnEntry: (...args: unknown[]) => checkOnEntry(...args) },
    },
    quota: { check: vi.fn() },
  },
}));

const questions: Question[] = [
  {
    id: 'q-prior',
    type: 'text',
    title: '지난 회차에 답한 질문',
    description: '',
    required: false,
    order: 0,
  },
  {
    id: 'q-new',
    type: 'text',
    title: '올해 새로 생긴 질문',
    description: '',
    required: false,
    order: 1,
  },
  {
    id: 'q-second-page',
    type: 'text',
    title: '두 번째 페이지 질문',
    description: '',
    required: false,
    order: 2,
    pageBreakBefore: true,
  },
] as Question[];

function createSurvey(overrides: Partial<Survey> = {}): Survey {
  return {
    id: 'survey-tracking',
    title: '추적조사 설문',
    status: 'published',
    currentVersionId: 'version-1',
    groups: [],
    questions,
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
    createdAt: new Date('2026-08-31T00:00:00.000Z'),
    updatedAt: new Date('2026-08-31T00:00:00.000Z'),
    ...overrides,
  } as Survey;
}

function renderFlow({ invite = true }: { invite?: boolean } = {}) {
  render(
    <SurveyResponseFlow
      mode="public"
      surveyIdentifier="survey-tracking"
      {...(invite ? { inviteToken: 'invite-1' } : {})}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
  Element.prototype.scrollIntoView = vi.fn();
  forResponse.mockResolvedValue({
    survey: createSurvey(),
    versionId: 'version-1',
    control: {
      isPaused: false,
      pausedMessage: null,
      testSession: null,
      testSessionKind: null,
      priorWaveLabel: '2025년 조사',
    },
  });
  attrsLookup.mockResolvedValue({});
  priorAnswersLookup.mockResolvedValue({ 'q-prior': '작년 답' });
  resume.mockResolvedValue(null);
  checkOnEntry.mockResolvedValue({ status: 'ok' });
  stepVisit.mockResolvedValue(undefined);
  saveDraft.mockResolvedValue({ applied: true });
  createWithFirstAnswer.mockResolvedValue({ id: 'response-1', versionId: 'version-1' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('변동 확인 컨트롤 노출', () => {
  it('이월 값이 있는 문항에만 컨트롤이 나타난다', async () => {
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() => {
      expect(screen.getAllByRole('radio', { name: '2025년 조사와 같음' })).toHaveLength(1);
    });
    // 신규 문항 자리에는 컨트롤이 없다 — 무엇과 비교할지 알 수 없다.
    expect(screen.getAllByRole('radio', { name: '달라졌습니다' })).toHaveLength(1);
  });

  it('표시 조건으로 숨겨진 문항에는 확인을 요구하지 않는다', async () => {
    const user = userEvent.setup();
    forResponse.mockResolvedValue({
      survey: createSurvey({
        questions: [
          {
            ...questions[0],
            // q-new 가 'yes' 일 때만 보이는 문항 — 초기값이 비어 있어 숨겨진다.
            displayCondition: {
              logicType: 'AND',
              conditions: [
                {
                  id: 'cond-1',
                  sourceQuestionId: 'q-new',
                  conditionType: 'value-match',
                  requiredValues: ['yes'],
                },
              ],
            },
          },
          questions[1],
          questions[2],
        ] as Question[],
      }),
      versionId: 'version-1',
      control: {
        isPaused: false,
        pausedMessage: null,
        testSession: null,
        testSessionKind: null,
        priorWaveLabel: '2025년 조사',
      },
    });

    renderFlow();
    await screen.findByText('올해 새로 생긴 질문');
    expect(screen.queryByRole('radio', { name: '2025년 조사와 같음' })).toBeNull();

    await user.click(screen.getByRole('button', { name: /다음/ }));
    expect(await screen.findByText('두 번째 페이지 질문')).toBeTruthy();
  });

  it('익명 응답자 화면에는 나타나지 않는다', async () => {
    renderFlow({ invite: false });
    await screen.findByText('지난 회차에 답한 질문');
    expect(screen.queryByRole('radio', { name: '2025년 조사와 같음' })).toBeNull();
  });
});

describe('변동 확인 진행 차단', () => {
  it('밝히지 않으면 다음으로 넘어가지 못하고 해당 문항을 짚어준다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: '2025년 조사와 같음' })).not.toBeNull(),
    );

    await user.click(screen.getByRole('button', { name: /다음/ }));

    // 페이지가 넘어가지 않았다
    expect(screen.queryByText('두 번째 페이지 질문')).toBeNull();
    expect(await screen.findByText(/변동 여부를 선택해주세요/)).toBeTruthy();
  });

  it('밝히면 다음 페이지로 넘어간다 — 응답 필수 여부와 무관하다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: '2025년 조사와 같음' })).not.toBeNull(),
    );

    await user.click(screen.getByRole('radio', { name: '2025년 조사와 같음' }));
    await user.click(screen.getByRole('button', { name: /다음/ }));

    expect(await screen.findByText('두 번째 페이지 질문')).toBeTruthy();
  });
});

describe('변동 확인 상태 보존', () => {
  it('밝힌 확인이 응답 저장 형태의 사이드카로 서버에 실려 간다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: '2025년 조사와 같음' })).not.toBeNull(),
    );

    // 실제 문항 답변이 있어야 응답 행이 생긴다 — 사이드카는 그 행에 얹혀 저장된다.
    const inputs = screen.getAllByRole('textbox');
    // 두 번째 입력이 신규 문항 — 첫 번째는 이월 값이 채워진 문항이다.
    await user.type(inputs[1] as HTMLElement, '올해 답');
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalled());

    await user.click(screen.getByRole('radio', { name: '달라졌습니다' }));
    await user.click(screen.getByRole('button', { name: /다음/ }));

    await waitFor(() => {
      const payloads = saveDraft.mock.calls.map(
        (call) => (call[0] as { answers: Record<string, unknown> }).answers,
      );
      expect(
        payloads.some(
          (answers) =>
            (answers['__changeConfirm__'] as Record<string, string> | undefined)?.['q-prior'] ===
            'changed',
        ),
      ).toBe(true);
    });
  });

  it('재진입 복원이 이미 밝힌 확인을 되살린다', async () => {
    window.localStorage.setItem('survey-session:survey-tracking:invite:invite-1', 'session-1');
    resume.mockResolvedValue({
      id: 'response-1',
      status: 'in_progress',
      questionResponses: { 'q-prior': '작년 답', __changeConfirm__: { 'q-prior': 'same' } },
      currentStepId: null,
      draftSeq: 3,
      resumed: false,
      affectedQuestionIds: [],
    });

    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() =>
      expect(
        (screen.getByRole('radio', { name: '2025년 조사와 같음' }) as HTMLInputElement).checked,
      ).toBe(true),
    );
  });
});
