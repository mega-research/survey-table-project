import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
import type { Question } from '@/types/survey';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const questions: Question[] = [
  {
    id: 'q-name',
    type: 'text',
    title: '업체명',
    description: '',
    required: true,
    order: 0,
  },
  {
    id: 'q-agree',
    type: 'radio',
    title: '동의 여부',
    description: '',
    required: true,
    order: 1,
    options: [
      { id: 'o1', label: '동의함', value: '1' },
      { id: 'o2', label: '동의하지 않음', value: '2' },
    ],
  },
  {
    id: 'q-memo',
    type: 'text',
    title: '덧붙일 말',
    description: '',
    required: true,
    order: 2,
    pageBreakBefore: true,
  },
];

const versionSnapshot: SurveyVersionSnapshot = {
  title: '조회 전용 설문',
  questions: questions as SurveyVersionSnapshot['questions'],
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

function renderReadOnly(initialResponses: Record<string, unknown>) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <SurveyResponseFlow
      mode="admin-edit"
      surveyIdentifier="admin-read-only"
      adminContext={{
        responseId: 'response-1',
        surveyId: 'survey-read-only',
        initialResponses,
        versionSnapshot,
        initialContactAttrs: {},
        migratedFromOldVersion: false,
        onSubmit,
        readOnlyView: { closeLabel: '닫기', onClose },
      }}
    />,
  );
  return { onSubmit, onClose };
}

/**
 * 응답 조회 화면(보기 전용 고객 계정) — 관리자 수정 흐름을 잠가 그린다. 값은 바뀌지 않고,
 * 덜 채운 응답도 끝까지 넘겨 볼 수 있으며, 마지막 쪽은 저장이 아니라 닫기다.
 */
describe('admin-edit 조회 전용', () => {
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

  it('글자 칸은 읽기 전용이라 쳐도 바뀌지 않고, 보기를 눌러도 선택이 바뀌지 않는다', async () => {
    renderReadOnly({ 'q-name': '메가유업', 'q-agree': '1' });
    const user = userEvent.setup();

    const input = await screen.findByDisplayValue('메가유업');
    await waitFor(() => expect(input).toHaveAttribute('readonly'));
    await user.click(input);
    await user.keyboard('XYZ');
    expect(input).toHaveValue('메가유업');

    const agree = screen.getByRole('radio', { name: '동의함' });
    const disagree = screen.getByRole('radio', { name: '동의하지 않음' });
    expect(agree).toBeChecked();
    await user.click(disagree);
    expect(agree).toBeChecked();
    expect(disagree).not.toBeChecked();
  });

  it('필수를 비운 응답도 경고 없이 넘어가고, 마지막 쪽은 닫기만 부른다', async () => {
    // 이탈 응답 — 첫 쪽의 필수 둘과 둘째 쪽의 필수가 모두 비어 있다.
    const { onSubmit, onClose } = renderReadOnly({});
    const user = userEvent.setup();

    await screen.findByText('업체명');
    await user.click(screen.getByRole('button', { name: '다음' }));
    // 한 번에 다음 쪽 — 관리자 수정의 「한 번 더 누르면」 경고가 없다.
    await screen.findByText('덧붙일 말');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다음' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('이전으로 돌아가도 저장된 답이 그대로 보인다', async () => {
    renderReadOnly({ 'q-name': '메가유업', 'q-agree': '2', 'q-memo': '없음' });
    const user = userEvent.setup();

    await screen.findByDisplayValue('메가유업');
    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByDisplayValue('없음')).toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: '이전' }));
    expect(await screen.findByDisplayValue('메가유업')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '동의하지 않음' })).toBeChecked();
  });
});
