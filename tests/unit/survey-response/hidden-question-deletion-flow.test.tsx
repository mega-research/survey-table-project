import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question, Survey } from '@/types/survey';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function createSurvey(): Survey {
  return {
    id: 'survey-hidden-question-deletion',
    title: '숨은 문항 삭제 설문',
    status: 'published',
    currentVersionId: 'version-1',
    groups: [],
    questions: [],
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
    createdAt: new Date('2026-09-07T00:00:00.000Z'),
    updatedAt: new Date('2026-09-07T00:00:00.000Z'),
  } as Survey;
}

/** q1 = 진학/취업, q2 = 진학일 때만, q3 = q2 가 '석사' 일 때만. 셋 다 같은 페이지. */
function createConditionalSurvey(): Survey {
  const base = createSurvey();
  return {
    ...base,
    questions: [
      {
        id: 'q1',
        type: 'radio',
        title: '진로 계획',
        description: '',
        required: false,
        order: 0,
        options: [
          { id: 'o1', value: 'grad', label: '① 진학' },
          { id: 'o2', value: 'job', label: '② 취업' },
        ],
      },
      {
        id: 'q2',
        type: 'radio',
        title: '진학 예정',
        description: '',
        required: false,
        order: 1,
        options: [
          { id: 'o3', value: 'master', label: '② 석사' },
          { id: 'o4', value: 'phd', label: '③ 박사' },
        ],
        displayCondition: {
          logicType: 'AND',
          conditions: [
            {
              id: 'c1',
              enabled: true,
              logicType: 'AND',
              conditionType: 'value-match',
              sourceQuestionId: 'q1',
              requiredValues: ['grad'],
            },
          ],
        },
      },
      {
        id: 'q3',
        type: 'text',
        title: '학위 취득 예정 시기',
        description: '',
        required: false,
        order: 2,
        displayCondition: {
          logicType: 'AND',
          conditions: [
            {
              id: 'c2',
              enabled: true,
              logicType: 'AND',
              conditionType: 'value-match',
              sourceQuestionId: 'q2',
              requiredValues: ['master'],
            },
          ],
        },
      },
    ] as Question[],
  } as Survey;
}

function renderFlow(survey: Survey) {
  render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier="preview-hidden-question-deletion"
      previewContext={{ survey, versionId: 'version-1' }}
    />,
  );
}

function setMobileViewport(isMobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: isMobile,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe('숨은 문항 응답 삭제', () => {
  beforeEach(() => {
    setMobileViewport(false);
    useSurveyResponseStore.getState().resetResponseState();
  });

  it('상류를 바꿔 문항이 숨으면 그 값에 기대던 하류도 사라진다', async () => {
    const user = userEvent.setup();
    renderFlow(createConditionalSurvey());

    await user.click(screen.getByLabelText('① 진학'));
    await user.click(await screen.findByLabelText('② 석사'));
    expect(await screen.findByText('학위 취득 예정 시기')).toBeInTheDocument();

    await user.click(screen.getByLabelText('② 취업'));

    // q2 가 숨으면서 값이 지워지고, 그 값에 기대던 q3 도 함께 사라진다
    await waitFor(() => {
      expect(screen.queryByText('진학 예정')).not.toBeInTheDocument();
      expect(screen.queryByText('학위 취득 예정 시기')).not.toBeInTheDocument();
    });
  });

  it('되돌려도 지워진 값은 살아나지 않는다', async () => {
    const user = userEvent.setup();
    renderFlow(createConditionalSurvey());

    await user.click(screen.getByLabelText('① 진학'));
    await user.click(await screen.findByLabelText('② 석사'));
    await user.click(screen.getByLabelText('② 취업'));
    await waitFor(() => expect(screen.queryByText('진학 예정')).not.toBeInTheDocument());

    await user.click(screen.getByLabelText('① 진학'));

    // 스펙 §받아들인 비용 — 삭제는 되돌릴 수 없다
    expect(await screen.findByLabelText('② 석사')).not.toBeChecked();
    expect(screen.queryByText('학위 취득 예정 시기')).not.toBeInTheDocument();
  });
});
