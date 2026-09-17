import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupManager } from '@/features/survey-builder/group-manager';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { QuestionConditionGroup, QuestionGroup } from '@/types/survey';

/**
 * 그룹 편집 저장은 폼 state 가 모르는 필드까지 실어야 한다. 표시 조건은 모달 안 조건 편집기가
 * store 에 바로 쓰는 값이라 폼 state 에 없다 — 저장 payload 를 폼 state 만으로 조립하면
 * 이름만 고쳐도 표시 조건이 빠진 채 덮어쓰인다.
 */

const { updateMock, ensureMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  ensureMock: vi.fn(),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      groups: { create: vi.fn(), update: updateMock, delete: vi.fn() },
      surveys: { ensure: ensureMock },
    },
  },
}));

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '33333333-3333-4333-8333-333333333333';

const displayCondition: QuestionConditionGroup = {
  logicType: 'AND',
  conditions: [
    {
      id: 'cond-1',
      name: '조건 1',
      sourceQuestionId: QUESTION_ID,
      conditionType: 'value-match',
      requiredValues: ['yes'],
      logicType: 'AND',
      enabled: true,
    },
  ],
};

function seedSurvey() {
  const store = useSurveyBuilderStore.getState();
  store.resetSurvey();
  const groups: QuestionGroup[] = [
    { id: GROUP_ID, surveyId: SURVEY_ID, name: '대상 그룹', order: 0, displayCondition },
  ];
  useSurveyBuilderStore.getState().setSurvey({
    id: SURVEY_ID,
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups,
    questions: [
      {
        id: QUESTION_ID,
        type: 'radio',
        title: '참조 질문',
        required: false,
        order: 0,
        options: [{ id: 'o1', label: '예', value: 'yes' }],
      },
    ],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** 그룹 행의 점 세 개 메뉴에서 "수정" 을 눌러 편집 모달을 연다. */
async function openEditModal(user: ReturnType<typeof userEvent.setup>) {
  const row = document.querySelector(`[data-group-id="${GROUP_ID}"]`);
  if (!(row instanceof HTMLElement)) throw new Error('그룹 행을 찾지 못했다');
  // 메뉴 버튼은 아이콘뿐이라 접근 가능한 이름이 없다 — Popover 트리거 속성으로 집는다.
  const menuButton = row.querySelector('button[aria-haspopup="dialog"]');
  if (!(menuButton instanceof HTMLElement)) throw new Error('그룹 메뉴 버튼을 찾지 못했다');
  await user.click(menuButton);
  await user.click(await screen.findByText('수정'));
  await screen.findByText('그룹 편집');
}

describe('GroupManager — 그룹 편집 저장', () => {
  beforeAll(() => {
    // Radix Popover·Select 가 jsdom 에 없는 API 를 호출한다 — 최소 폴리필.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false) as never;
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockResolvedValue(undefined);
    ensureMock.mockResolvedValue(undefined);
    seedSurvey();
  });

  afterEach(() => cleanup());

  it('이름만 바꿔 저장해도 store 의 표시 조건이 payload 에 그대로 실린다', async () => {
    const user = userEvent.setup();
    render(<GroupManager />);

    await openEditModal(user);
    const nameInput = screen.getByPlaceholderText('예: 응답자 정보, 1. TV보유 현황');
    await user.clear(nameInput);
    await user.type(nameInput, '이름 바꾼 그룹');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    const payload = updateMock.mock.calls.at(-1)?.[0];
    expect(payload.groupId).toBe(GROUP_ID);
    expect(payload.surveyId).toBe(SURVEY_ID);
    expect(payload.data.name).toBe('이름 바꾼 그룹');
    expect(payload.data.displayCondition).toEqual(displayCondition);
  });

  it('저장하면 편집 모달이 닫힌다', async () => {
    const user = userEvent.setup();
    render(<GroupManager />);

    await openEditModal(user);
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.queryByText('그룹 편집')).toBeNull());
  });

  it('취소하면 저장하지 않고 모달이 닫힌다', async () => {
    const user = userEvent.setup();
    render(<GroupManager />);

    await openEditModal(user);
    await user.click(screen.getByRole('button', { name: '취소' }));

    await waitFor(() => expect(screen.queryByText('그룹 편집')).toBeNull());
    expect(updateMock).not.toHaveBeenCalled();
  });
});
