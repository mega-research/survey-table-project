import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import type { SurveyVersionSnapshot } from '@/db/schema';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question, Survey } from '@/types/survey';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// 데스크톱 뷰포트 — 흐름 테스트 관례를 따른다 (use-media-query 가 matchMedia 를 요구한다).
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

/**
 * 구버전에서 수집된 응답을 관리자가 편집할 때는 숨은 문항 값을 지우지 않는다 — 재발행으로
 * 조건이 강화됐을 뿐인데 저장 한 번에 답이 사라지면 복구할 수 없다(스펙 2026-09-07).
 *
 * 그 보존이 **기타 상세기재까지 미치는지**를 고정한다. `buildOptTextsPayload` 는 스토어의
 * 옵션 텍스트를 표시되는 문항으로만 걸러 다시 조립하므로 숨은 문항 몫은 거기서 떨어진다.
 * 그래도 살아남는 이유는 조립 결과가 `responses` 위에 얹히고 그 `responses` 가 이미
 * `__optTexts__` 를 들고 있기 때문이다(admin-edit 은 initialResponses 로 시드된다).
 * 숨은 문항 strip 을 건너뛰면 그 사이드카가 통째로 남는다.
 *
 * 조립 쪽만 보고 "표시 문항만 남는다" 고 읽으면 구멍처럼 보이는 자리다 — 두 경로가 합쳐져야
 * 계약이 성립하므로 어느 한쪽을 건드릴 때 여기서 걸리게 둔다.
 */
const GATE = 'q-gate';
const DETAILED = 'q-detailed';
const OTHER_OPTION = 'opt-other';

/** 게이트가 yes 일 때만 보이는 문항 — 그 문항의 보기 하나가 상세기재를 받는다. */
function createSurvey(): Survey {
  const questions: Question[] = [
    {
      id: GATE,
      type: 'radio',
      title: '게이트',
      description: '',
      required: false,
      order: 0,
      options: [
        { id: 'opt-yes', value: 'yes', label: '예' },
        { id: 'opt-no', value: 'no', label: '아니오' },
      ],
    },
    {
      id: DETAILED,
      type: 'radio',
      title: '상세기재가 붙은 문항',
      description: '',
      required: false,
      order: 1,
      options: [{ id: OTHER_OPTION, value: 'other', label: '기타', allowTextInput: true }],
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c1',
            enabled: true,
            logicType: 'AND',
            conditionType: 'value-match',
            sourceQuestionId: GATE,
            requiredValues: ['yes'],
          },
        ],
      },
    },
  ] as unknown as Question[];

  return {
    id: 'survey-1',
    title: '구버전 편집',
    description: '',
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
    createdAt: new Date('2026-09-07T00:00:00.000Z'),
    updatedAt: new Date('2026-09-07T00:00:00.000Z'),
  } as Survey;
}

function renderAdminEdit(migratedFromOldVersion: boolean) {
  const survey = createSurvey();
  const versionSnapshot: SurveyVersionSnapshot = {
    title: survey.title,
    questions: survey.questions as SurveyVersionSnapshot['questions'],
    groups: [],
    settings: {
      isPublic: true,
      allowMultipleResponses: true,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '감사합니다.',
    },
  };
  const onSubmit = vi.fn().mockResolvedValue(undefined);

  render(
    <SurveyResponseFlow
      mode="admin-edit"
      surveyIdentifier={survey.id}
      adminContext={{
        responseId: 'response-1',
        surveyId: survey.id,
        // 게이트가 'no' 라 상세 문항은 지금 구조에서 숨는다. 그래도 답과 상세기재가 남아 있다 —
        // 응답이 수집된 구버전에서는 보이던 문항이기 때문이다.
        // __optTexts__ 는 initialResponses 안에 실려 스토어로 시드된다 (use-survey-loader).
        initialResponses: {
          [GATE]: 'no',
          [DETAILED]: 'other',
          __optTexts__: { [DETAILED]: { [OTHER_OPTION]: '지난 회차에 적은 상세' } },
        } as never,
        versionSnapshot,
        initialContactAttrs: {},
        migratedFromOldVersion,
        onSubmit,
      }}
    />,
  );
  return onSubmit;
}

async function submit() {
  const user = userEvent.setup();
  const button = await screen.findByRole('button', { name: /저장|제출|다음/ });
  await user.click(button);
}

describe('구버전 응답 편집의 기타 상세기재 보존', () => {
  it('구버전이면 숨은 문항의 답과 상세기재가 함께 남는다', async () => {
    const onSubmit = renderAdminEdit(true);

    await submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    expect(payload.questionResponses[DETAILED]).toBe('other');
    expect(payload.questionResponses['__optTexts__']).toEqual({
      [DETAILED]: { [OTHER_OPTION]: '지난 회차에 적은 상세' },
    });
  });

  it('같은 버전이면 종전대로 숨은 문항이 답도 상세기재도 남기지 않는다', async () => {
    const onSubmit = renderAdminEdit(false);

    await submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    expect(payload.questionResponses[DETAILED]).toBeUndefined();
    // 사이드카 자체는 남고 그 문항 항목만 빠진다 — 빈 사이드카는 저장 경계가 정제한다.
    expect(payload.questionResponses['__optTexts__']).toEqual({});
  });
});

// 스토어는 파일 간 공유이므로 각 테스트 뒤 정리한다.
afterEach(() => useSurveyResponseStore.getState().resetResponseState());
