import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setClosed = vi.fn();
const refresh = vi.fn();
const toastError = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: { operations: { control: { setClosed: (input: unknown) => setClosed(input) } } },
}));

import { SurveyCloseControl } from './survey-close-control';

/**
 * 설문 종료 스위치 (ADR-0030).
 *
 * 종료는 중단과 달리 **외부 접근을 한 번에 닫는다.** 그래서 누르기 전에 무엇이 바뀌는지를
 * 확인 창이 말해야 한다 — 특히 「진행 중 응답은 제출된다」와 「메일은 계속 나간다」는 버튼
 * 이름에서 짐작할 수 없다.
 */
describe('SurveyCloseControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setClosed.mockImplementation(async (input: { isClosed: boolean }) => ({
      isClosed: input.isClosed,
    }));
  });

  it('종료 확인 창이 바뀌는 것 네 가지를 말한다', async () => {
    const user = userEvent.setup();
    render(<SurveyCloseControl surveyId="sv-1" initialClosed={false} />);

    await user.click(screen.getByRole('button', { name: '설문 종료' }));
    const dialog = await screen.findByRole('alertdialog');

    expect(within(dialog).getByText(/새 응답을 받지 않습니다/)).toBeInTheDocument();
    expect(within(dialog).getByText(/외주 실사 링크와 클라이언트 링크가 닫힙니다/)).toBeInTheDocument();
    expect(within(dialog).getByText(/응답하던 사람은 끝까지 제출할 수 있습니다/)).toBeInTheDocument();
    expect(within(dialog).getByText(/메일은 계속 발송됩니다/)).toBeInTheDocument();
    // 확인 전에는 아무것도 보내지 않는다.
    expect(setClosed).not.toHaveBeenCalled();
  });

  it('확인하면 종료하고 종료됨으로 바뀐다', async () => {
    const user = userEvent.setup();
    render(<SurveyCloseControl surveyId="sv-1" initialClosed={false} />);

    await user.click(screen.getByRole('button', { name: '설문 종료' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '종료' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '종료됨' })).toBeInTheDocument());
    expect(setClosed).toHaveBeenCalledWith({ surveyId: 'sv-1', isClosed: true });
    // 헤더 아래 화면(RSC)이 종료 상태를 다시 읽는다.
    expect(refresh).toHaveBeenCalled();
  });

  it('종료된 설문은 종료 취소를 묻고, 확인하면 종료 전으로 돌아간다', async () => {
    const user = userEvent.setup();
    render(<SurveyCloseControl surveyId="sv-1" initialClosed />);

    await user.click(screen.getByRole('button', { name: '종료됨' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/같은 주소와 같은 비밀번호로 다시 열립니다/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '종료 취소' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '설문 종료' })).toBeInTheDocument(),
    );
    expect(setClosed).toHaveBeenCalledWith({ surveyId: 'sv-1', isClosed: false });
  });

  it('실패하면 상태를 바꾸지 않고 서버가 준 이유를 알린다', async () => {
    setClosed.mockRejectedValue(new Error('발행된 적 없는 설문은 종료할 수 없습니다.'));
    const user = userEvent.setup();
    render(<SurveyCloseControl surveyId="sv-1" initialClosed={false} />);

    await user.click(screen.getByRole('button', { name: '설문 종료' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '종료' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('발행된 적 없는 설문은 종료할 수 없습니다.'),
    );
    expect(screen.queryByRole('button', { name: '종료됨' })).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
