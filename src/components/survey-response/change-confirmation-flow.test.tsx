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
  complete,
  createBlank,
  checkOnEntry,
} = vi.hoisted(() => ({
  forResponse: vi.fn(),
  attrsLookup: vi.fn(),
  priorAnswersLookup: vi.fn(),
  resume: vi.fn(),
  stepVisit: vi.fn(),
  createWithFirstAnswer: vi.fn(),
  saveDraft: vi.fn(),
  complete: vi.fn(),
  createBlank: vi.fn(),
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
        createBlank: (...args: unknown[]) => createBlank(...args),
        saveDraft: (...args: unknown[]) => saveDraft(...args),
        complete: (...args: unknown[]) => complete(...args),
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
  createWithFirstAnswer.mockResolvedValue({
    kind: 'created',
    id: 'response-1',
    versionId: 'version-1',
    contactTargetId: 'contact-1',
  });
  createBlank.mockResolvedValue({
    kind: 'created',
    id: 'response-1',
    versionId: 'version-1',
    contactTargetId: 'contact-1',
  });
  complete.mockResolvedValue({ id: 'response-1' });
});

/** complete 로 서버에 실제로 나간 응답 묶음. */
function submittedResponses(): Record<string, unknown> {
  const call = complete.mock.calls.at(-1)?.[0] as
    | { data?: { questionResponses?: Record<string, unknown> } }
    | undefined;
  return call?.data?.questionResponses ?? {};
}

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

describe('이월 값 잠금과 복사', () => {
  /** 첫 문항(이월 값 보유)의 입력란. */
  function priorInput(): HTMLInputElement {
    return screen.getAllByRole('textbox')[0] as HTMLInputElement;
  }

  /**
   * 실제 잠김 여부. `input.disabled` 는 자기 속성만 반영하므로(브라우저도 동일)
   * fieldset 조상으로 잠긴 상태는 `:disabled` 매칭으로 본다.
   */
  function priorInputLocked(): boolean {
    return priorInput().matches(':disabled');
  }

  it('밝히기 전에는 입력이 잠긴 채 이월 값이 보인다', async () => {
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() => expect(priorInput().value).toBe('작년 답'));
    expect(priorInputLocked()).toBe(true);
  });

  it('"달라짐"을 고르면 입력이 열리고 이월 값이 채워진 채로 시작한다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() => expect(priorInputLocked()).toBe(true));

    await user.click(screen.getByRole('radio', { name: '달라졌습니다' }));

    await waitFor(() => expect(priorInputLocked()).toBe(false));
    expect(priorInput().value).toBe('작년 답');
  });

  it('"같음"을 고르면 잠긴 채로 남고 이월 값이 이번 회차 응답으로 나간다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() => expect(priorInputLocked()).toBe(true));

    await user.click(screen.getByRole('radio', { name: '2025년 조사와 같음' }));
    expect(priorInputLocked()).toBe(true);

    await user.click(screen.getByRole('button', { name: /다음/ }));
    await screen.findByText('두 번째 페이지 질문');
    // 마지막 스텝의 제출 버튼도 라벨은 "다음" 이다.
    await user.click(screen.getByRole('button', { name: /다음/ }));

    await waitFor(() => expect(submittedResponses()['q-prior']).toBe('작년 답'));
  });

  it('"달라짐"에서 고친 뒤 "같음"으로 되돌리면 이월 값으로 돌아간다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() => expect(priorInputLocked()).toBe(true));

    await user.click(screen.getByRole('radio', { name: '달라졌습니다' }));
    await waitFor(() => expect(priorInputLocked()).toBe(false));
    await user.clear(priorInput());
    await user.type(priorInput(), '올해 답');
    await waitFor(() => expect(priorInput().value).toBe('올해 답'));

    await user.click(screen.getByRole('radio', { name: '2025년 조사와 같음' }));
    await waitFor(() => expect(priorInput().value).toBe('작년 답'));
  });

  it('보지 못한 문항은 이월 값으로 채워지지 않고 빈칸으로 남는다', async () => {
    const user = userEvent.setup();
    forResponse.mockResolvedValue({
      survey: createSurvey({
        questions: [
          questions[0],
          questions[1],
          questions[2],
          {
            id: 'q-unreached',
            type: 'text',
            title: '도달하지 못하는 질문',
            description: '',
            required: false,
            order: 3,
            // q-new 가 'yes' 여야 보이는데 응답자는 손대지 않는다.
            displayCondition: {
              logicType: 'AND',
              conditions: [
                {
                  id: 'cond-unreached',
                  sourceQuestionId: 'q-new',
                  conditionType: 'value-match',
                  requiredValues: ['yes'],
                },
              ],
            },
          },
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
    priorAnswersLookup.mockResolvedValue({
      'q-prior': '작년 답',
      'q-unreached': '작년에 답한 값',
    });

    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: '2025년 조사와 같음' })).not.toBeNull(),
    );

    await user.click(screen.getByRole('radio', { name: '2025년 조사와 같음' }));
    await user.click(screen.getByRole('button', { name: /다음/ }));
    await screen.findByText('두 번째 페이지 질문');
    // 마지막 스텝의 제출 버튼도 라벨은 "다음" 이다.
    await user.click(screen.getByRole('button', { name: /다음/ }));

    await waitFor(() => expect(complete).toHaveBeenCalled());
    expect(submittedResponses()['q-prior']).toBe('작년 답');
    expect(submittedResponses()['q-unreached']).toBeUndefined();
  });
});

describe('필수 여부와 변동 확인은 별개 축이다', () => {
  /** q-prior 를 필수로 세운 설문 — 이월 값이 있고 아직 밝히지 않은 상태다. */
  function arrangeRequiredPriorQuestion() {
    forResponse.mockResolvedValue({
      survey: createSurvey({
        questions: [{ ...questions[0], required: true }, questions[1], questions[2]] as Question[],
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
  }

  it('잠긴 필수 문항에 "필수 질문에 답변해주세요"를 띄우지 않는다', async () => {
    arrangeRequiredPriorQuestion();
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: '2025년 조사와 같음' })).not.toBeNull(),
    );
    // 입력이 잠겨 있어 응답자가 따를 수 없는 요구다 — 변동 확인 게이트가 대신 막는다.
    expect(screen.queryByText(/필수 질문에 답변해주세요/)).toBeNull();
  });

  it('잠긴 필수 문항에서 "다음"을 누르면 필수가 아니라 변동 확인을 요구한다', async () => {
    const user = userEvent.setup();
    arrangeRequiredPriorQuestion();
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: '2025년 조사와 같음' })).not.toBeNull(),
    );

    await user.click(screen.getByRole('button', { name: /다음/ }));

    expect(await screen.findByText(/변동 여부를 선택해주세요/)).toBeTruthy();
    expect(screen.queryByText('필수 질문입니다')).toBeNull();
  });

  it('밝히고 나면 복사된 이월 값이 필수를 충족해 다음으로 넘어간다', async () => {
    const user = userEvent.setup();
    arrangeRequiredPriorQuestion();
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

describe('완전 동일 확인', () => {
  it('"달라짐"인데 한 칸도 안 고쳤으면 제출 전에 한 번 묻고, 확인하면 제출된다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: '달라졌습니다' })).not.toBeNull(),
    );

    await user.click(screen.getByRole('radio', { name: '달라졌습니다' }));
    await user.click(screen.getByRole('button', { name: /다음/ }));
    await screen.findByText('두 번째 페이지 질문');
    // 마지막 스텝의 제출 버튼도 라벨은 "다음" 이다.
    await user.click(screen.getByRole('button', { name: /다음/ }));

    // 막지 않고 묻기만 한다 — 아직 제출은 나가지 않았다.
    const dialogText = await screen.findByText(/달라졌다고 하셨지만/);
    expect(dialogText).toBeTruthy();
    expect(complete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '이대로 제출' }));
    await waitFor(() => expect(complete).toHaveBeenCalled());
  });

  it('"같음"만 고른 응답은 되묻지 않고 바로 제출된다', async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByText('지난 회차에 답한 질문');
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: '2025년 조사와 같음' })).not.toBeNull(),
    );

    await user.click(screen.getByRole('radio', { name: '2025년 조사와 같음' }));
    await user.click(screen.getByRole('button', { name: /다음/ }));
    await screen.findByText('두 번째 페이지 질문');
    // 마지막 스텝의 제출 버튼도 라벨은 "다음" 이다.
    await user.click(screen.getByRole('button', { name: /다음/ }));

    await waitFor(() => expect(complete).toHaveBeenCalled());
    expect(screen.queryByText(/달라졌다고 하셨지만/)).toBeNull();
  });
});
