import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyStatusControl } from './survey-status-control';

const setClosed = vi.fn();
const setPaused = vi.fn();
const refresh = vi.fn();
const toastError = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    operations: {
      control: {
        setClosed: (input: unknown) => setClosed(input),
        setPaused: (input: unknown) => setPaused(input),
      },
    },
  },
}));

const OPEN: { isPaused: boolean; pausedMessage: string | null; isClosed: boolean } = {
  isPaused: false,
  pausedMessage: null,
  isClosed: false,
};

function renderControl(initial: Partial<typeof OPEN> = {}) {
  return render(<SurveyStatusControl surveyId="sv-1" initial={{ ...OPEN, ...initial }} />);
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, buttonName: RegExp | string) {
  await user.click(screen.getByRole('button', { name: buttonName }));
  return screen.findByRole('menu');
}

/**
 * 설문 중단·종료 메뉴 (ADR-0030) — 테스트 모드처럼 버튼 하나가 메뉴만 열고, 중단과 종료는
 * 메뉴 안의 토글이다. 두 축은 독립이라 함께 켜질 수 있다.
 *
 * 종료는 외부 접근을 한 번에 닫으므로 누르기 전에 무엇이 바뀌는지를 확인 창이 말해야 한다 —
 * 특히 「진행 중 응답은 제출된다」와 「메일은 계속 나간다」는 이름에서 짐작할 수 없다.
 */
describe('SurveyStatusControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setClosed.mockImplementation(async (input: { isClosed: boolean }) => ({
      isClosed: input.isClosed,
    }));
    setPaused.mockImplementation(async (input: { isPaused: boolean; pausedMessage?: string }) => ({
      isPaused: input.isPaused,
      pausedMessage: input.pausedMessage ?? null,
    }));
  });

  it('버튼은 메뉴만 열고 메뉴에는 중단·종료 토글이 있다', async () => {
    const user = userEvent.setup();
    renderControl();

    const menu = await openMenu(user, /응답 받는 중/);
    const toggles = within(menu).getAllByRole('menuitemcheckbox');
    expect(toggles.map((t) => t.textContent?.slice(0, 5))).toEqual(['설문 중단', '설문 종료']);
    expect(toggles.every((t) => t.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(setPaused).not.toHaveBeenCalled();
    expect(setClosed).not.toHaveBeenCalled();
  });

  it('중단 토글은 안내 문구를 받고 확인하면 중단 중이 된다', async () => {
    const user = userEvent.setup();
    renderControl();

    const menu = await openMenu(user, /응답 받는 중/);
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: /설문 중단/ }));
    const dialog = await screen.findByRole('dialog');
    const textarea = within(dialog).getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, '잠시 점검 중입니다.');
    await user.click(within(dialog).getByRole('button', { name: '설문 중단' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /중단 중/ })).toBeInTheDocument(),
    );
    expect(setPaused).toHaveBeenCalledWith({
      surveyId: 'sv-1',
      isPaused: true,
      pausedMessage: '잠시 점검 중입니다.',
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('중단 중에 토글을 끄면 재개를 묻는다', async () => {
    const user = userEvent.setup();
    renderControl({ isPaused: true, pausedMessage: '점검' });

    const menu = await openMenu(user, /중단 중/);
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: /설문 중단/ }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: '재개' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /응답 받는 중/ })).toBeInTheDocument(),
    );
    expect(setPaused).toHaveBeenCalledWith({ surveyId: 'sv-1', isPaused: false });
  });

  it('종료 확인 창이 바뀌는 것 네 가지를 말한다', async () => {
    const user = userEvent.setup();
    renderControl();

    const menu = await openMenu(user, /응답 받는 중/);
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: /설문 종료/ }));
    const dialog = await screen.findByRole('alertdialog');

    expect(within(dialog).getByText(/새 응답을 받지 않습니다/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/외주 실사 링크와 클라이언트 링크가 닫힙니다/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/응답하던 사람은 끝까지 제출할 수 있습니다/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/메일은 계속 발송됩니다/)).toBeInTheDocument();
    expect(setClosed).not.toHaveBeenCalled();
  });

  it('확인하면 종료하고 버튼이 종료됨으로 바뀐다', async () => {
    const user = userEvent.setup();
    renderControl();

    const menu = await openMenu(user, /응답 받는 중/);
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: /설문 종료/ }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: '종료' }),
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /종료됨/ })).toBeInTheDocument());
    expect(setClosed).toHaveBeenCalledWith({ surveyId: 'sv-1', isClosed: true });
    expect(refresh).toHaveBeenCalled();
  });

  it('종료된 설문은 종료 취소를 묻고, 확인하면 종료 전으로 돌아간다', async () => {
    const user = userEvent.setup();
    renderControl({ isClosed: true });

    const menu = await openMenu(user, /종료됨/);
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: /설문 종료/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/같은 주소와 같은 비밀번호로 다시 열립니다/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '종료 취소' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /응답 받는 중/ })).toBeInTheDocument(),
    );
    expect(setClosed).toHaveBeenCalledWith({ surveyId: 'sv-1', isClosed: false });
  });

  it('중단과 종료는 함께 켜질 수 있고 버튼은 종료를 앞세운다', async () => {
    const user = userEvent.setup();
    renderControl({ isPaused: true, isClosed: true });

    const button = screen.getByRole('button', { name: /종료됨/ });
    expect(button).toHaveTextContent('중단');
    const menu = await openMenu(user, /종료됨/);
    expect(
      within(menu)
        .getAllByRole('menuitemcheckbox')
        .map((t) => t.getAttribute('aria-checked')),
    ).toEqual(['true', 'true']);
  });

  it('실패하면 상태를 바꾸지 않고 서버가 준 이유를 알린다', async () => {
    setClosed.mockRejectedValue(new Error('발행된 적 없는 설문은 종료할 수 없습니다.'));
    const user = userEvent.setup();
    renderControl();

    const menu = await openMenu(user, /응답 받는 중/);
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: /설문 종료/ }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: '종료' }),
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('발행된 적 없는 설문은 종료할 수 없습니다.'),
    );
    expect(screen.queryByRole('button', { name: /종료됨/ })).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
