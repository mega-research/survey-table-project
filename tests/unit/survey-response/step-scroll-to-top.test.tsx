import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import type { Question, Survey } from '@/types/survey';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// scrollTo 호출 시점의 DOM 을 함께 기록한다. 새 페이지가 커밋되기 전에 호출하면
// iOS WebKit 이 예약된 스크롤 애니메이션을 폐기해 화면이 그대로 남는다.
type ScrollCall = { options: unknown; nextPageRendered: boolean };

let scrollCalls: ScrollCall[] = [];

function spyOnScroll(nextPageMarker: string) {
  scrollCalls = [];
  vi.spyOn(window, 'scrollTo').mockImplementation(((...args: unknown[]) => {
    scrollCalls.push({
      options: args[0],
      nextPageRendered: document.body.textContent?.includes(nextPageMarker) ?? false,
    });
  }) as typeof window.scrollTo);
}

function buildSurvey(questions: Question[], id: string): Survey {
  return {
    id,
    title: '스크롤 검증 설문',
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
    createdAt: new Date('2026-08-05T00:00:00.000Z'),
    updatedAt: new Date('2026-08-05T00:00:00.000Z'),
  } as Survey;
}

/** 1페이지 라디오 → 2페이지 텍스트 (일반 다음 이동) */
function simpleSurvey(): Survey {
  return buildSurvey(
    [
      {
        id: 'q-first',
        type: 'radio',
        title: '첫 페이지 질문',
        description: '',
        required: false,
        order: 0,
        options: [
          { id: 'opt-yes', value: 'yes', label: '예' },
          { id: 'opt-no', value: 'no', label: '아니오' },
        ],
      },
      {
        id: 'q-second',
        type: 'text',
        title: '둘째 페이지 질문',
        description: '',
        required: false,
        order: 1,
        pageBreakBefore: true,
      },
    ],
    'survey-simple-scroll',
  );
}

/** 1페이지 → (조건 미충족으로 전부 숨겨지는) 2페이지 → 3페이지 자동 스킵 착지 */
function autoSkipSurvey(): Survey {
  return buildSurvey(
    [
      {
        id: 'q-source',
        type: 'radio',
        title: '첫 페이지 질문',
        description: '',
        required: false,
        order: 0,
        options: [
          { id: 'opt-show', value: 'show', label: '표시' },
          { id: 'opt-hide', value: 'hide', label: '숨김' },
        ],
      },
      {
        id: 'q-conditional',
        type: 'text',
        title: '조건부 페이지 질문',
        description: '',
        required: false,
        order: 1,
        pageBreakBefore: true,
        displayCondition: {
          logicType: 'AND',
          conditions: [
            {
              id: 'show-conditional-page',
              sourceQuestionId: 'q-source',
              conditionType: 'value-match',
              logicType: 'AND',
              requiredValues: ['show'],
            },
          ],
        },
      },
      {
        id: 'q-landing',
        type: 'text',
        title: '착지 페이지 질문',
        description: '',
        required: false,
        order: 2,
        pageBreakBefore: true,
      },
    ],
    'survey-auto-skip-scroll',
  );
}

function renderFlow(survey: Survey) {
  render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier={`preview-${survey.id}`}
      previewContext={{ survey, versionId: 'version-1' }}
    />,
  );
}

// 상단/하단에 동일한 다음 버튼이 있어 마지막 것을 누른다.
async function clickNext(user: ReturnType<typeof userEvent.setup>) {
  const buttons = await screen.findAllByRole('button', { name: /다음/ });
  await user.click(buttons[buttons.length - 1]!);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('스텝 이동 시 맨 위로 스크롤', () => {
  beforeEach(() => {
    scrollCalls = [];
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true, // 모바일 뷰
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it('다음 페이지가 DOM 에 커밋된 뒤에 즉시 스크롤로 맨 위로 올린다', async () => {
    const user = userEvent.setup();
    spyOnScroll('둘째 페이지 질문');
    renderFlow(simpleSurvey());

    await clickNext(user);
    await screen.findByText('둘째 페이지 질문');

    const topScrolls = scrollCalls.filter(
      (call) =>
        typeof call.options === 'object' &&
        call.options !== null &&
        (call.options as { top?: number }).top === 0,
    );
    expect(topScrolls.length).toBeGreaterThan(0);
    // 커밋 이전 호출은 WebKit 에서 폐기되므로 단 한 번도 있어서는 안 된다.
    expect(topScrolls.every((call) => call.nextPageRendered)).toBe(true);
    // 전역 html { scroll-behavior: smooth } 때문에 'auto' 는 즉시 이동이 아니다.
    expect(
      topScrolls.every(
        (call) => (call.options as { behavior?: string }).behavior === 'instant',
      ),
    ).toBe(true);
  });

  it('조건부로 비어버린 페이지를 자동 스킵할 때도 맨 위로 올린다', async () => {
    const user = userEvent.setup();
    spyOnScroll('착지 페이지 질문');
    renderFlow(autoSkipSurvey());

    await user.click(await screen.findByRole('radio', { name: /숨김/ }));
    await clickNext(user);

    await screen.findByText('착지 페이지 질문');
    await waitFor(() => {
      expect(scrollCalls.some((call) => call.nextPageRendered)).toBe(true);
    });
  });
});
