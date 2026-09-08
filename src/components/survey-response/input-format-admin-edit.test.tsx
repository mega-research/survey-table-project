import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import type { SurveyVersionSnapshot } from '@/db/schema';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question } from '@/types/survey';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const question: Question = {
  id: 'q-mobile',
  type: 'text',
  title: '휴대전화',
  description: '',
  required: false,
  order: 0,
  inputType: 'mobile',
};

const versionSnapshot: SurveyVersionSnapshot = {
  title: '형식 검사 설문',
  questions: [question] as SurveyVersionSnapshot['questions'],
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

function renderAdminEdit(
  initialResponses: Record<string, unknown>,
  onSubmit: (payload: { questionResponses: Record<string, unknown> }) => Promise<void>,
) {
  render(
    <SurveyResponseFlow
      mode="admin-edit"
      surveyIdentifier="admin-input-format"
      adminContext={{
        responseId: 'response-1',
        surveyId: 'survey-input-format',
        initialResponses,
        versionSnapshot,
        initialContactAttrs: {},
        migratedFromOldVersion: false,
        onSubmit,
      }}
    />,
  );
}

/**
 * 관리자 응답 편집은 형식 불일치를 차단하지 않는다 — 외국 번호·대표번호 같은 정당한
 * 예외를 담당자가 넣을 수 있어야 한다(2026-09-08 결정). 응답자 표면은 그대로 차단이다.
 */
describe('admin-edit — 입력 형식은 경고 후 통과', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
    // jsdom 에 없는 API — 경고 배너가 위반 위치로 스크롤할 때 부른다.
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

  it('형식이 틀리면 첫 클릭은 경고, 값 변경 없는 두 번째 클릭은 그대로 저장한다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderAdminEdit({ 'q-mobile': '+81 90 1234 5678' }, onSubmit);
    const user = userEvent.setup();

    await screen.findByText('휴대전화');
    const nextButton = () => screen.getByRole('button', { name: '다음' });

    await user.click(nextButton());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "형식이 맞지 않는 값 1개 — '다음 →' 한 번 더 누르면 그대로 넘어갑니다",
    );

    await user.click(nextButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0].questionResponses['q-mobile']).toBe('+81 90 1234 5678');
  });

  it('형식이 맞으면 경고 없이 한 번에 저장한다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderAdminEdit({ 'q-mobile': '010-1234-5678' }, onSubmit);
    const user = userEvent.setup();

    await screen.findByText('휴대전화');
    await user.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('포커스를 둔 채 다음을 눌러도 정규형으로 저장된다 (iOS 제출 경로)', async () => {
    // handleNext 가 클릭 안에서 blur 를 부르지만 그 setState 는 같은 클릭 안에서 커밋되지
    // 않는다 — 저장 경계가 스스로 정돈하지 않으면 비정규 원문이 그대로 실린다.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderAdminEdit({}, onSubmit);
    const user = userEvent.setup();

    await screen.findByText('휴대전화');
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.keyboard('01012345678');

    await user.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0].questionResponses['q-mobile']).toBe('010-1234-5678');
  });

  it('포커스가 남은 채 클릭이 들어와도 정규형으로 저장된다 (blur 가 클릭 핸들러 안에서 일어나는 경로)', async () => {
    // iOS 대응으로 handleNext 가 스스로 activeElement.blur() 를 부른다. 그 blur 가 예약한
    // setState 는 같은 클릭 안에서 커밋되지 않으므로, 저장 경계가 스스로 정돈해야 한다.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderAdminEdit({}, onSubmit);
    const user = userEvent.setup();

    await screen.findByText('휴대전화');
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.keyboard('01012345678');

    // fireEvent 는 포커스를 옮기지 않는다 — 입력칸이 포커스를 쥔 채 클릭만 들어온다.
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0].questionResponses['q-mobile']).toBe('010-1234-5678');
  });
});
