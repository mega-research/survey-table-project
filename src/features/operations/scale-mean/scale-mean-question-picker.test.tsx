import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ScaleMeanCandidate } from '@/lib/operations/scale-mean-format';

import { ScaleMeanQuestionPicker } from './scale-mean-question-picker';

const setQuestionsMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/lib/rpc', () => ({
  client: { operations: { scaleMean: { setQuestions: setQuestionsMock } } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

const CANDIDATES: ScaleMeanCandidate[] = [
  { questionId: 'q1', code: 'Q1', title: '1. 사업 만족도', rowCount: 1, enabled: true },
  { questionId: 'q2', code: 'Q2', title: '2. 지원 만족도', rowCount: 1, enabled: false },
  { questionId: 'm', code: 'Q7', title: '7. 요소별 만족도', rowCount: 3, enabled: false },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ScaleMeanQuestionPicker', () => {
  it('후보마다 체크박스를 그리고 켜진 문항이 체크되어 있다 — 행렬 척도는 행 수를 보인다', () => {
    render(<ScaleMeanQuestionPicker surveyId={SURVEY_ID} candidates={CANDIDATES} />);
    expect(screen.getByRole('checkbox', { name: /Q1/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Q2/ })).not.toBeChecked();
    expect(screen.getByText('행 3개')).toBeInTheDocument();
  });

  it('바꾼 것이 없으면 저장을 누를 수 없다', () => {
    render(<ScaleMeanQuestionPicker surveyId={SURVEY_ID} candidates={CANDIDATES} />);
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  it('고른 문항 전체를 후보 순서대로 보내고 화면을 다시 읽는다', async () => {
    setQuestionsMock.mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    render(
      <ScaleMeanQuestionPicker surveyId={SURVEY_ID} candidates={CANDIDATES} onSaved={onSaved} />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /Q7/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Q2/ }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(setQuestionsMock).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      questionIds: ['q1', 'q2', 'm'],
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('전체 선택·전체 해제', () => {
    render(<ScaleMeanQuestionPicker surveyId={SURVEY_ID} candidates={CANDIDATES} />);
    fireEvent.click(screen.getByRole('button', { name: '전체 선택' }));
    expect(
      screen.getAllByRole('checkbox').every((el) => el.getAttribute('data-state') === 'checked'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '전체 해제' }));
    expect(
      screen.getAllByRole('checkbox').every((el) => el.getAttribute('data-state') === 'unchecked'),
    ).toBe(true);
  });

  it('거부되면 문구를 보이고 화면을 다시 읽지 않는다', async () => {
    setQuestionsMock.mockResolvedValue({
      ok: false,
      error: '평균을 낼 수 없는 문항이 섞여 있습니다.',
    });
    render(<ScaleMeanQuestionPicker surveyId={SURVEY_ID} candidates={CANDIDATES} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Q2/ }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '평균을 낼 수 없는 문항이 섞여 있습니다.',
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
