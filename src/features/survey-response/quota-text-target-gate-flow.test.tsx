import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { Question, Survey } from '@/types/survey';

/**
 * 텍스트형 쿼터 차원의 대상 칸은 런타임 필수다.
 *
 * 회귀: 쿼터 문항은 필수로 강제되지만 표 문항의 "답변됨"은 객체에 키가 하나라도 있으면 참이라,
 * 대상 칸(주소)에 셀 필수가 없는 표에서는 다른 칸(회사명)만 채우고 넘어갈 수 있었다. 그러면
 * 쿼터 확인은 발동하지 않고 응답은 미분류로 끝까지 완료된다 — 마감된 쿼터를 정상 화면에서
 * 우회하는 길이었다.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/features/survey-response/response-document-pane', () => ({
  ResponseDocumentPane: () => <div data-testid="document-pane" />,
}));

const questions: Question[] = [
  {
    id: 'q1',
    type: 'table',
    title: '일반 현황',
    description: '',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'col-label', label: '항목' },
      { id: 'col-value', label: '내용' },
    ],
    tableRowsData: [
      {
        id: 'row-name',
        label: '기업명',
        cells: [
          { id: 'c-name-label', type: 'text', content: '기업명' },
          { id: 'c-name', type: 'input', content: '', placeholder: '기업명 입력' },
        ],
      },
      {
        id: 'row-address',
        label: '주소',
        cells: [
          { id: 'c-address-label', type: 'text', content: '주소' },
          // 셀 필수가 **없다** — 이 테스트의 요점이다.
          { id: 'c-sido', type: 'input', content: '', placeholder: '시도 입력' },
        ],
      },
    ],
  },
  {
    id: 'q2',
    type: 'text',
    title: '다음 쪽 질문',
    description: '',
    required: false,
    order: 1,
    pageBreakBefore: true,
  },
] as Question[];

function createSurvey(): Survey {
  return {
    id: 'survey-quota-text-target',
    title: '쿼터 대상 칸 설문',
    status: 'published',
    currentVersionId: 'version-1',
    groups: [],
    questions,
    quotaGate: { questionIds: ['q1'], cellIdsByQuestion: { q1: ['c-sido'] } },
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
    createdAt: new Date('2026-09-21T00:00:00.000Z'),
    updatedAt: new Date('2026-09-21T00:00:00.000Z'),
  } as Survey;
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
  Element.prototype.scrollIntoView = vi.fn();
  useSurveyResponseStore.getState().resetResponseState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('텍스트형 쿼터 대상 칸의 필수 강제', () => {
  it('다른 칸만 채우면 「다음」이 막히고, 대상 칸을 채우면 넘어간다', async () => {
    const user = userEvent.setup();
    render(
      <SurveyResponseFlow
        mode="preview"
        surveyIdentifier="preview-quota-text-target"
        previewContext={{ survey: createSurvey(), versionId: 'version-1' }}
      />,
    );

    await user.type(await screen.findByPlaceholderText('기업명 입력'), '메가리서치');
    await user.click(screen.getByRole('button', { name: '다음' }));

    // 막혔다 — 다음 쪽이 열리지 않고 같은 표가 그대로 있다.
    expect(screen.queryByText('다음 쪽 질문')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('시도 입력')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('시도 입력'), '경기도');
    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(await screen.findByText('다음 쪽 질문')).toBeInTheDocument();
  });
});
