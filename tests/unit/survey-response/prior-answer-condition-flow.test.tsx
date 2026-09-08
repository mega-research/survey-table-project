import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question, Survey } from '@/types/survey';

/**
 * 문항 단위 이월값 불러오기 조건(`priorAnswerCondition`) 플로우 레벨 커버리지.
 *
 * 대상 시나리오는 CONTEXT.md 의 동기 사례와 같다 — BQ1(이직 여부)이 ①이직함이면
 * q-employ(취업 현황)는 지난 회차 값을 받지 않아야 하고, ②이직 안 함이면 받는다.
 * `change-confirmation-flow.test.tsx` 의 하네스(mock 구성)를 그대로 재사용한다.
 */

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

const MOVED = 'q-moved';
const EMPLOY = 'q-employ';

/** BQ1 = 이직 여부, q-employ = 취업 현황(이직 안 했을 때만 이월값을 받는다). */
const questions: Question[] = [
  {
    id: MOVED,
    type: 'radio',
    title: '이직 여부',
    description: '',
    required: false,
    order: 0,
    options: [
      { id: 'o-yes', value: 'yes', label: '① 이직함' },
      { id: 'o-no', value: 'no', label: '② 이직 안 함' },
    ],
  },
  {
    id: EMPLOY,
    type: 'text',
    title: '취업 현황',
    description: '',
    required: false,
    order: 1,
    priorAnswerCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: 'c1',
          enabled: true,
          logicType: 'AND',
          conditionType: 'value-match',
          sourceQuestionId: MOVED,
          requiredValues: ['no'],
        },
      ],
    },
  },
] as Question[];

function createSurvey(overrides: Partial<Survey> = {}): Survey {
  return {
    id: 'survey-prior-condition',
    title: '이월값 조건 설문',
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
    createdAt: new Date('2026-09-08T00:00:00.000Z'),
    updatedAt: new Date('2026-09-08T00:00:00.000Z'),
    ...overrides,
  } as Survey;
}

function renderFlow() {
  render(
    <SurveyResponseFlow mode="public" surveyIdentifier="survey-prior-condition" inviteToken="invite-1" />,
  );
}

function mockControl(changeConfirmEnabled: boolean) {
  forResponse.mockResolvedValue({
    survey: createSurvey(),
    versionId: 'version-1',
    control: {
      isPaused: false,
      pausedMessage: null,
      testSession: null,
      testSessionKind: null,
      priorWaveLabel: '2025년 조사',
      changeConfirmEnabled,
    },
  });
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
  attrsLookup.mockResolvedValue({});
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

describe('이월값 불러오기 조건 — 변동 확인 꺼짐(프리필 경로)', () => {
  it('조건이 참이면 이월 값이 프리필된다', async () => {
    mockControl(false);
    priorAnswersLookup.mockResolvedValue({ [MOVED]: 'no', [EMPLOY]: 'SK텔레콤' });
    renderFlow();

    await screen.findByText('이직 여부');
    await waitFor(() => expect(screen.getByRole('radio', { name: '② 이직 안 함' })).toBeChecked());
    await screen.findByDisplayValue('SK텔레콤');
  });

  it('조건이 참 → 거짓으로 뒤집히면, 응답자가 고친 값도 회수된다', async () => {
    const user = userEvent.setup();
    mockControl(false);
    priorAnswersLookup.mockResolvedValue({ [MOVED]: 'no', [EMPLOY]: 'SK텔레콤' });
    renderFlow();

    await screen.findByText('이직 여부');
    const input = await screen.findByDisplayValue('SK텔레콤');
    await user.clear(input);
    await user.type(input, '응답자가 고친 회사');
    await waitFor(() => expect(screen.getByDisplayValue('응답자가 고친 회사')).toBeInTheDocument());

    // BQ1 을 "이직함"으로 고치면 q-employ 의 조건이 거짓으로 뒤집힌다.
    await user.click(screen.getByRole('radio', { name: '① 이직함' }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue('응답자가 고친 회사')).toBeNull();
      expect(screen.queryByDisplayValue('SK텔레콤')).toBeNull();
    });
    const textboxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(textboxes.every((el) => el.value === '')).toBe(true);

    // 회수가 화면에서만 끝나지 않고 실제 제출 페이로드에도 반영된다 — 제출된 값이
    // 회수 전 값(응답자가 고친 값이든 이월 값이든) 어느 쪽도 아니다.
    await user.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(complete).toHaveBeenCalled());
    const call = complete.mock.calls.at(-1)?.[0] as
      | { data?: { questionResponses?: Record<string, unknown> } }
      | undefined;
    const submitted = call?.data?.questionResponses ?? {};
    expect(submitted[EMPLOY]).not.toBe('SK텔레콤');
    expect(submitted[EMPLOY]).not.toBe('응답자가 고친 회사');
  });

  it('조건이 처음부터 거짓이면 응답자가 직접 쓴 답은 지워지지 않는다', async () => {
    const user = userEvent.setup();
    mockControl(false);
    // BQ1 이 이월값으로 '이직함'을 받아 처음부터 조건이 거짓이다 — q-employ 는 애초에
    // 프리필되지 않는다.
    priorAnswersLookup.mockResolvedValue({ [MOVED]: 'yes', [EMPLOY]: 'SK텔레콤' });
    renderFlow();

    await screen.findByText('이직 여부');
    await waitFor(() => expect(screen.getByRole('radio', { name: '① 이직함' })).toBeChecked());
    // 프리필되지 않아 빈 칸이다.
    const textboxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    const employInput = textboxes.find((el) => el.value === '');
    expect(employInput).toBeDefined();

    await user.type(employInput as HTMLInputElement, '응답자가 직접 쓴 회사');
    await waitFor(() =>
      expect(screen.getByDisplayValue('응답자가 직접 쓴 회사')).toBeInTheDocument(),
    );

    // 조건이 계속 거짓인 채로 잠시 더 렌더링되어도(다른 응답 변화) 값이 지워지지 않는다.
    await user.click(screen.getByRole('radio', { name: '① 이직함' }));
    await waitFor(() =>
      expect(screen.getByDisplayValue('응답자가 직접 쓴 회사')).toBeInTheDocument(),
    );
  });
});

describe('이월값 불러오기 조건 — 변동 확인 켜짐', () => {
  it('조건이 거짓인 문항은 이월 값 확인 대상으로 뜨지 않는다', async () => {
    mockControl(true);
    // q-moved 는 조건이 없는 일반 이월 문항 — 항상 확인 컨트롤이 뜬다.
    // q-employ 는 q-moved 가 아직 응답되지 않아(=조건 미충족) 확인 대상에서 빠져야 한다.
    priorAnswersLookup.mockResolvedValue({ [MOVED]: 'yes', [EMPLOY]: 'SK텔레콤' });
    renderFlow();

    await screen.findByText('이직 여부');
    // q-moved 한 문항에만 확인 컨트롤이 뜬다 — q-employ 몫까지 2개가 뜨면 조건이
    // 무시된 것이다.
    await waitFor(() => {
      expect(screen.getAllByRole('radio', { name: '2025년 조사와 같음' })).toHaveLength(1);
    });
    expect(screen.getAllByRole('radio', { name: '달라졌습니다' })).toHaveLength(1);
    // q-employ 는 지난 회차 값으로 잠겨 보이지 않는다 — 평범한 빈 입력이어야 한다.
    expect(screen.queryByDisplayValue('SK텔레콤')).toBeNull();
    const textboxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(textboxes.some((el) => el.value === '' && !el.disabled)).toBe(true);
  });
});
