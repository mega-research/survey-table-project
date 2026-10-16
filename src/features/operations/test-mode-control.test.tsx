import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestModeControl } from '@/features/operations/test-mode-control';

// 테스트 모드 켜기/끄기가 useMutation 이라 QueryClientProvider 가 필요하다 — 렌더 호출은 그대로, 래퍼만 공급
function render(ui: ReactElement) {
  const client = new QueryClient();
  // wrapper 옵션은 rerender 에도 적용된다 — 직접 감싸면 rerender(<Next/>) 에서 Provider 가 사라진다
  return rtlRender(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

const {
  controlGetMock,
  controlSetTestModeMock,
  controlDisableMock,
  generateTestMock,
  refreshMock,
} = vi.hoisted(() => ({
  controlGetMock: vi.fn(),
  controlSetTestModeMock: vi.fn(),
  controlDisableMock: vi.fn(),
  generateTestMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    operations: {
      control: {
        get: controlGetMock,
        setTestMode: controlSetTestModeMock,
        disable: controlDisableMock,
      },
    },
    contacts: { targets: { generateTest: generateTestMock } },
  },
}));

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

function initial(overrides: Record<string, unknown> = {}) {
  return {
    testModeEnabled: true,
    testViewInBrowser: true,
    testToken: 'anon-token',
    accessIdentifier: 'survey-one',
    testResponseCount: 2,
    testTargetCount: 0,
    firstTestInviteCode: null,
    ...overrides,
  };
}

const COOKIE_NAME = `ops-test-view-${SURVEY_ID}`;

/** 헤더의 테스트 모드 버튼 — 상태에 따라 「테스트 모드」 또는 「테스트 데이터 보는 중」이다. */
const trigger = () => screen.getByRole('button', { name: /테스트 (모드|데이터 보는 중)/ });

/** 메뉴 항목을 순서대로 — 일반 항목과 켜고 끄는 항목(menuitemcheckbox)을 함께. */
function menuEntries(menu: HTMLElement) {
  return [...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].map((el) => ({
    role: el.getAttribute('role'),
    text: el.textContent ?? '',
    disabled: el.hasAttribute('data-disabled'),
    checked: el.getAttribute('aria-checked'),
  }));
}

function clearTestViewCookie() {
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearTestViewCookie();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('TestModeControl popup contract', () => {
  it('메뉴는 테스트 모드 · 링크 복사 · 테스트 데이터 보기 · 대상자 생성 넷이고 anonymous 링크를 복사한다', async () => {
    const user = userEvent.setup();
    const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText');
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial()} />);

    await user.hover(trigger());
    const menu = await screen.findByRole('menu');
    const entries = menuEntries(menu);
    expect(entries.map((e) => [e.role, e.text.split(/모든|이 브라우저|켜면|이미/)[0]])).toEqual([
      ['menuitemcheckbox', '테스트 모드'],
      ['menuitem', '테스트 링크 복사'],
      ['menuitemcheckbox', '테스트 데이터 보기'],
      ['menuitem', '테스트 조사 대상자 생성'],
    ]);
    expect(entries.map((e) => e.checked)).toEqual(['true', null, 'true', null]);
    expect(entries.every((e) => !e.disabled)).toBe(true);
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);

    await user.click(within(menu).getByRole('menuitem', { name: '테스트 링크 복사' }));
    expect(clipboardWrite).toHaveBeenCalledWith(
      'http://localhost:3000/survey/survey-one?test=anon-token',
    );
  });

  it('대상자 1명 이상은 생성 항목을 막고 resid 첫 invite 링크를 복사한다', async () => {
    const user = userEvent.setup();
    const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText');
    render(
      <TestModeControl
        surveyId={SURVEY_ID}
        initial={initial({ testTargetCount: 1, firstTestInviteCode: 'invite-first' })}
      />,
    );

    await user.hover(trigger());
    const menu = await screen.findByRole('menu');
    const generator = within(menu).getByRole('menuitem', { name: /테스트 조사 대상자 생성/ });
    expect(generator).toHaveAttribute('data-disabled');
    expect(generator).toHaveTextContent('이미 1명을 만들었습니다');

    await user.click(within(menu).getByRole('menuitem', { name: '테스트 링크 복사' }));
    expect(clipboardWrite).toHaveBeenCalledWith('http://localhost:3000/i/invite-first');
  });

  it('대상자 생성 dialog는 두 필드만 받고 성공 후 control을 다시 조회한다', async () => {
    const user = userEvent.setup();
    generateTestMock.mockResolvedValue({ createdCount: 3 });
    controlGetMock.mockResolvedValue(
      initial({
        testTargetCount: 3,
        firstTestInviteCode: 'invite-first',
      }),
    );
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial()} />);

    await user.hover(trigger());
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /테스트 조사 대상자 생성/ }));

    const dialog = await screen.findByRole('dialog', { name: '테스트 대상자 생성' });
    const countInput = within(dialog).getByRole('spinbutton', { name: '생성 인원' });
    const emailInput = within(dialog).getByRole('textbox', { name: '메일 받을 테스트 주소' });
    expect(within(dialog).getAllByRole('spinbutton')).toHaveLength(1);
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);

    await user.clear(countInput);
    await user.type(countInput, '3');
    await user.type(emailInput, 'qa@example.com');
    await user.click(within(dialog).getByRole('button', { name: '생성' }));

    expect(generateTestMock).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      count: 3,
      recipientEmail: 'qa@example.com',
    });
    expect(controlGetMock).toHaveBeenCalledWith({ surveyId: SURVEY_ID });
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it('대상자 생성 검증 오류는 첫 invalid 필드에 focus하고 오류를 접근 가능하게 연결한다', async () => {
    const user = userEvent.setup();
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial()} />);

    await user.hover(trigger());
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: /테스트 조사 대상자 생성/,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: '테스트 대상자 생성' });
    const emailInput = within(dialog).getByRole('textbox', { name: '메일 받을 테스트 주소' });
    await user.click(within(dialog).getByRole('button', { name: '생성' }));

    expect(emailInput).toHaveFocus();
    expect(emailInput).toHaveAttribute('aria-describedby', 'test-contact-email-error');
    const alert = within(dialog).getByRole('alert');
    expect(alert).toHaveAttribute('id', 'test-contact-email-error');
    expect(alert).toHaveTextContent('올바른 이메일 주소를 입력하세요.');
  });

  it('stale 생성 오류는 dialog를 닫고 control을 다시 조회한다', async () => {
    const user = userEvent.setup();
    generateTestMock.mockRejectedValue(new Error('TEST_TARGET_GENERATION_STALE'));
    controlGetMock.mockResolvedValue(
      initial({
        testTargetCount: 1,
        firstTestInviteCode: 'created-elsewhere',
      }),
    );
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial()} />);

    await user.hover(trigger());
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: /테스트 조사 대상자 생성/,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: '테스트 대상자 생성' });
    await user.type(
      within(dialog).getByRole('textbox', { name: '메일 받을 테스트 주소' }),
      'qa@example.com',
    );
    await user.click(within(dialog).getByRole('button', { name: '생성' }));

    expect(await screen.queryByRole('dialog', { name: '테스트 대상자 생성' })).toBeNull();
    expect(controlGetMock).toHaveBeenCalledWith({ surveyId: SURVEY_ID });
  });
});

describe('TestModeControl exit dialog contract', () => {
  it('대상자와 응답이 0이어도 항상 exact 3-button dialog를 표시한다', async () => {
    const user = userEvent.setup();
    const zeroState = initial({ testResponseCount: 0 });
    controlGetMock.mockResolvedValue(zeroState);
    render(<TestModeControl surveyId={SURVEY_ID} initial={zeroState} />);

    await user.hover(trigger());
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: /^테스트 모드/ }),
    );

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('테스트 응답 0건을 삭제할까요?')).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['취소', '보관하고 끄기', '삭제 후 끄기']);
  });

  it('대상자 title과 세 문장을 순서대로 표시하고 keep을 한 번 호출한다', async () => {
    const user = userEvent.setup();
    const targetedState = initial({
      testResponseCount: 3,
      testTargetCount: 2,
      firstTestInviteCode: 'invite-first',
    });
    controlDisableMock.mockResolvedValue({
      testModeEnabled: false,
      testViewInBrowser: false,
      deletedResponseCount: 0,
      deletedTargetCount: 0,
      remainingResponseCount: 3,
      remainingTargetCount: 2,
    });
    render(<TestModeControl surveyId={SURVEY_ID} initial={targetedState} />);

    await user.hover(trigger());
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: /^테스트 모드/ }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText('테스트 대상자 2명과 응답 3건을 삭제할까요?'),
    ).toBeInTheDocument();
    expect([...dialog.querySelectorAll('p')].map((node) => node.textContent)).toEqual([
      '테스트 모드에서 수집된 응답은 통계·집계에서 항상 제외됩니다. 삭제하면 복구할 수 없으니, 보관하려면 “보관하고 끄기”를 선택하세요.',
      '다른 관리자가 진행 중인 테스트와 발송된 테스트 링크도 중단됩니다.',
      '테스트 데이터를 모두 삭제하고 진행 중인 발송을 중단합니다. 이미 발송된 메일은 취소할 수 없습니다.',
    ]);

    await user.click(within(dialog).getByRole('button', { name: '보관하고 끄기' }));
    expect(controlDisableMock).toHaveBeenCalledTimes(1);
    expect(controlDisableMock).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      disposition: 'keep',
    });
  });

  it('삭제 후 끄기는 delete를 한 번만 호출하고 anonymous 상태로 되돌린다', async () => {
    const user = userEvent.setup();
    const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText');
    const targetedState = initial({
      testTargetCount: 1,
      firstTestInviteCode: 'invite-first',
    });
    controlDisableMock.mockResolvedValue({
      testModeEnabled: false,
      testViewInBrowser: false,
      deletedResponseCount: 2,
      deletedTargetCount: 1,
      remainingResponseCount: 0,
      remainingTargetCount: 0,
    });
    controlSetTestModeMock.mockResolvedValue({
      isPaused: false,
      pausedMessage: null,
      ...initial({
        testModeEnabled: true,
        testViewInBrowser: true,
        testResponseCount: 0,
        testTargetCount: 0,
        firstTestInviteCode: null,
      }),
    });
    render(<TestModeControl surveyId={SURVEY_ID} initial={targetedState} />);

    await user.hover(trigger());
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: /^테스트 모드/ }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: '삭제 후 끄기' }));

    expect(controlDisableMock).toHaveBeenCalledTimes(1);
    expect(controlDisableMock).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      disposition: 'delete',
    });
    await waitFor(() => expect(trigger()).toHaveAccessibleName('테스트 모드'));
    await user.hover(trigger());
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: /^테스트 모드/ }),
    );
    await waitFor(() => expect(controlSetTestModeMock).toHaveBeenCalledTimes(1));
    expect(clipboardWrite).toHaveBeenCalledWith(
      'http://localhost:3000/survey/survey-one?test=anon-token',
    );
  });

  it('다른 관리자가 먼저 종료한 stale disable은 control을 즉시 다시 읽고 dialog를 닫는다', async () => {
    const user = userEvent.setup();
    controlDisableMock.mockRejectedValue(new Error('TEST_WORKSPACE_DISABLE_STALE'));
    controlGetMock.mockResolvedValue(initial({ testModeEnabled: false, testViewInBrowser: false }));
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial()} />);

    await user.hover(trigger());
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: /^테스트 모드/ }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: '삭제 후 끄기' }));

    await waitFor(() => expect(controlGetMock).toHaveBeenCalledWith({ surveyId: SURVEY_ID }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger()).toHaveAccessibleName('테스트 모드');
  });
});

describe('TestModeControl global state sync', () => {
  it('router refresh로 RSC initial이 바뀌면 local state도 즉시 동기화한다', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TestModeControl
        surveyId={SURVEY_ID}
        initial={initial({ testModeEnabled: false, testViewInBrowser: false, testResponseCount: 0 })}
      />,
    );

    rerender(
      <TestModeControl
        surveyId={SURVEY_ID}
        initial={initial({ testTargetCount: 1, firstTestInviteCode: 'invite-refreshed' })}
      />,
    );
    await user.hover(trigger());

    const menu = await screen.findByRole('menu');
    expect(
      within(menu).getByRole('menuitem', { name: /테스트 조사 대상자 생성/ }),
    ).toHaveAttribute('data-disabled');
  });

  it('focus refresh는 snapshot 변경이 있을 때만 router를 refresh한다', async () => {
    controlGetMock.mockResolvedValueOnce(initial());
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial()} />);

    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(controlGetMock).toHaveBeenCalledTimes(1));
    expect(refreshMock).not.toHaveBeenCalled();

    controlGetMock.mockResolvedValueOnce(
      initial({
        testTargetCount: 1,
        firstTestInviteCode: 'invite-other-admin',
      }),
    );
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(controlGetMock).toHaveBeenCalledTimes(2));
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it('10초 polling으로 control.get을 다시 호출한다', async () => {
    vi.useFakeTimers();
    try {
      controlGetMock.mockResolvedValue(initial());
      render(<TestModeControl surveyId={SURVEY_ID} initial={initial()} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(controlGetMock).toHaveBeenCalledWith({ surveyId: SURVEY_ID });
      expect(refreshMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('겹친 focus 조회는 늦게 끝난 과거 응답으로 최신 상태를 덮어쓰지 않는다', async () => {
    let resolveFirst!: (value: ReturnType<typeof initial>) => void;
    let resolveSecond!: (value: ReturnType<typeof initial>) => void;
    controlGetMock
      .mockImplementationOnce(
        () => new Promise<ReturnType<typeof initial>>((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<ReturnType<typeof initial>>((resolve) => (resolveSecond = resolve)),
      );
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial()} />);

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(controlGetMock).toHaveBeenCalledTimes(2));

    await act(async () => resolveSecond(initial({ testModeEnabled: false, testViewInBrowser: false })));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '테스트 모드' })).not.toHaveClass(
        'border-amber-300',
      ),
    );
    await act(async () => resolveFirst(initial()));
    expect(trigger()).toHaveAccessibleName('테스트 모드');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

describe('TestModeControl 브라우저별 테스트 데이터 보기', () => {
  it('버튼은 눌러도 아무것도 바꾸지 않고 메뉴만 연다 — 호버로 열린 메뉴를 클릭이 닫지 않는다', async () => {
    const user = userEvent.setup();
    render(
      <TestModeControl
        surveyId={SURVEY_ID}
        initial={initial({ testModeEnabled: false, testViewInBrowser: false })}
      />,
    );

    await user.click(trigger());

    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.click(trigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(controlSetTestModeMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('테스트 모드가 꺼져 있으면 링크 복사·테스트 데이터 보기·대상자 생성이 막힌다', async () => {
    const user = userEvent.setup();
    render(
      <TestModeControl
        surveyId={SURVEY_ID}
        initial={initial({ testModeEnabled: false, testViewInBrowser: false })}
      />,
    );

    await user.hover(trigger());
    const entries = menuEntries(await screen.findByRole('menu'));
    expect(entries.map((e) => e.disabled)).toEqual([false, true, true, true]);
    expect(entries[0]?.checked).toBe('false');
  });

  it('테스트 모드를 켜도 이 브라우저의 테스트 데이터 보기는 켜지 않는다', async () => {
    const user = userEvent.setup();
    controlSetTestModeMock.mockResolvedValue(initial({ testViewInBrowser: false }));
    render(
      <TestModeControl
        surveyId={SURVEY_ID}
        initial={initial({ testModeEnabled: false, testViewInBrowser: false })}
      />,
    );

    await user.hover(trigger());
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: /^테스트 모드/ }),
    );

    await waitFor(() => expect(controlSetTestModeMock).toHaveBeenCalledTimes(1));
    expect(document.cookie).not.toContain(`${COOKIE_NAME}=1`);
    await waitFor(() => expect(trigger()).toHaveAccessibleName(/^테스트 모드/));
    expect(trigger()).toHaveTextContent('ON');
  });

  it('다른 사람이 켠 테스트 모드에서 테스트 데이터 보기를 켜면 쿠키만 켜고 버튼이 「테스트 데이터 보는 중」이 된다', async () => {
    const user = userEvent.setup();
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial({ testViewInBrowser: false })} />);

    expect(trigger()).toHaveTextContent('테스트 모드');
    await user.hover(trigger());
    const view = within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', {
      name: /테스트 데이터 보기/,
    });
    expect(view).toHaveAttribute('aria-checked', 'false');
    expect(view).toHaveTextContent('지금 실데이터를 보는 중');
    await user.click(view);

    expect(controlSetTestModeMock).not.toHaveBeenCalled();
    expect(document.cookie).toContain(`${COOKIE_NAME}=1`);
    expect(refreshMock).toHaveBeenCalled();
    expect(trigger()).toHaveTextContent('테스트 데이터 보는 중');
  });

  it('테스트 데이터 보기를 끄면 쿠키만 지우고 테스트 모드는 끄지 않는다', async () => {
    const user = userEvent.setup();
    document.cookie = `${COOKIE_NAME}=1; path=/`;
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial()} />);

    await user.hover(trigger());
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', {
        name: /테스트 데이터 보기/,
      }),
    );

    expect(controlDisableMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(document.cookie).not.toContain(`${COOKIE_NAME}=1`);
    expect(trigger()).toHaveTextContent('테스트 모드');
  });

  it('실데이터를 보는 채로 대상자 생성을 누르면 테스트 데이터 보기를 함께 켠다', async () => {
    const user = userEvent.setup();
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial({ testViewInBrowser: false })} />);

    await user.hover(trigger());
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: /테스트 조사 대상자 생성/,
      }),
    );

    expect(await screen.findByRole('dialog', { name: '테스트 대상자 생성' })).toBeInTheDocument();
    expect(document.cookie).toContain(`${COOKIE_NAME}=1`);
  });

  it('테스트 모드가 꺼졌는데 쿠키가 남아 있으면 지운다 — 다시 켜질 때 묻지 않고 테스트 보기로 돌아가지 않게', async () => {
    document.cookie = `${COOKIE_NAME}=1; path=/`;
    render(
      <TestModeControl
        surveyId={SURVEY_ID}
        initial={initial({ testModeEnabled: false, testViewInBrowser: true })}
      />,
    );

    await waitFor(() => expect(document.cookie).not.toContain(`${COOKIE_NAME}=1`));
  });
});
