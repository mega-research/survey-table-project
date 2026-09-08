import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import type { SurveyVersionSnapshot } from '@/db/schema';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question } from '@/types/survey';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const textQuestion: Question = {
  id: 'q-text',
  type: 'text',
  title: '작년 매출액',
  description: '',
  required: false,
  order: 0,
};

const versionSnapshot: SurveyVersionSnapshot = {
  title: '추적조사',
  questions: [textQuestion] as SurveyVersionSnapshot['questions'],
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

function renderAdminEdit({
  initialResponses,
  initialPriorAnswers,
  onSubmit = vi.fn(async () => {}),
}: {
  initialResponses: Record<string, unknown>;
  initialPriorAnswers: Record<string, unknown> | null;
  onSubmit?: (payload: { questionResponses: Record<string, unknown> }) => Promise<void>;
}) {
  render(
    <SurveyResponseFlow
      mode="admin-edit"
      surveyIdentifier="admin-prior-highlight"
      adminContext={{
        responseId: 'response-1',
        surveyId: 'survey-prior-highlight',
        initialResponses,
        versionSnapshot,
        initialContactAttrs: {},
        initialPriorAnswers,
        migratedFromOldVersion: false,
        onSubmit,
      }}
    />,
  );
}

/**
 * 관리자 응답 편집의 이월 표시.
 *
 * **색 단언 3건은 skip 이다 — `PRIOR_HIGHLIGHT_ENABLED=false`(2026-09-09 실사 중 끔).**
 * 스위치를 다시 켜면 `.skip` 을 떼면 된다. 지우지 말 것: 이 셋이 "RSC 가 실어 보낸 이월
 * 응답이 화면까지 닿는가" 를 지키는 유일한 테스트다.
 * 마지막 "표시 전용 계약" 테스트는 스위치와 무관하므로 그대로 돈다.
 *
 * RSC 가 이월 응답을 실어 보내도 로더가 그것을 어느 state 에도 넣지 않으면 색이 통째로
 * 죽는다 — 타입은 통과하고 판정 단위 테스트도 전부 초록이라 실제로 그렇게 새어 나갔다.
 * 그래서 이 파일은 플로우를 끝까지 렌더해 화면에 색이 붙는지를 본다.
 */
describe('admin-edit — 이월 표시', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    useSurveyResponseStore.getState().resetResponseState();
  });
  afterEach(() => vi.restoreAllMocks());

  it.skip('이월 값과 같은 칸이 빨강으로 그려진다', async () => {
    renderAdminEdit({
      initialResponses: { 'q-text': '1000' },
      initialPriorAnswers: { 'q-text': '1000' },
    });

    const input = await screen.findByRole('textbox');
    await waitFor(() => expect(input.className).toContain('text-red-600'));
  });

  it.skip('관리자가 고치면 빨강이 사라진다', async () => {
    renderAdminEdit({
      initialResponses: { 'q-text': '1000' },
      initialPriorAnswers: { 'q-text': '1000' },
    });

    const input = await screen.findByRole('textbox');
    await waitFor(() => expect(input.className).toContain('text-red-600'));
    await userEvent.type(input, '0');
    await waitFor(() => expect(input.className).not.toContain('text-red-600'));
  });

  it.skip('이월 응답이 없으면 칠하지 않는다', async () => {
    renderAdminEdit({
      initialResponses: { 'q-text': '1000' },
      initialPriorAnswers: null,
    });

    const input = await screen.findByRole('textbox');
    await waitFor(() => expect(input).toHaveValue('1000'));
    expect(input.className).not.toContain('text-red-600');
  });

  /**
   * 표시 전용 계약 — 이월 응답을 실었다고 프리필이 깨어나면 안 된다.
   * 관리자 편집은 changeConfirmEnabled 가 항상 false 라, 이월 값이 null 이던 동안에만
   * 프리필이 저절로 무동작이었다. 관리자가 열어 보기만 해도 지난 회차 값이 응답에 깔리면
   * 사고다.
   *
   * 지금은 두 겹으로 막혀 있다 — 관리자 이월 응답은 표시 전용 채널로만 들어가 프리필이
   * 읽는 `priorAnswers` 가 여전히 null 이고, 프리필·회수 effect 에도 `isAdminEdit` 경계가
   * 있다. 이 테스트가 지키는 것은 그 구현이 아니라 **계약**이라, 나중에 누가 관리자 이월
   * 응답을 `priorAnswers` 로 되돌려도 여기서 걸린다.
   */
  it('이월 값이 있어도 응답에 깔리지 않는다 — 빈 칸은 빈 채로 저장된다', async () => {
    const submitted: Record<string, unknown>[] = [];
    renderAdminEdit({
      initialResponses: {},
      initialPriorAnswers: { 'q-text': '작년 값' },
      onSubmit: async (payload) => {
        submitted.push(payload.questionResponses);
      },
    });

    const input = await screen.findByRole('textbox');
    expect(input).toHaveValue('');
    // 프리필 effect 가 돌 기회를 준 뒤에도 여전히 비어 있어야 한다.
    await waitFor(() => expect(input).toHaveValue(''));

    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).not.toHaveProperty('q-text');
  });
});
