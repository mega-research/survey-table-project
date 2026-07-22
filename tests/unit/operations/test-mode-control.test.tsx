import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestModeControl } from '@/components/operations/test-mode-control';

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
    testToken: 'anon-token',
    accessIdentifier: 'survey-one',
    testResponseCount: 2,
    testTargetCount: 0,
    firstTestInviteCode: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('TestModeControl popup contract', () => {
  it('대상자 0명은 copy/create/separator/off만 표시하고 anonymous 링크를 복사한다', async () => {
    const user = userEvent.setup();
    const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText');
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial()} />);

    await user.hover(screen.getByRole('button', { name: '테스트 모드' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['테스트 링크 복사', '테스트 대상자 생성', '테스트 모드 끄기']);
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);

    await user.click(within(menu).getByRole('menuitem', { name: '테스트 링크 복사' }));
    expect(clipboardWrite).toHaveBeenCalledWith(
      'http://localhost:3000/survey/survey-one?test=anon-token',
    );
  });

  it('대상자 1명 이상은 copy/separator/off만 표시하고 resid 첫 invite 링크를 복사한다', async () => {
    const user = userEvent.setup();
    const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText');
    render(
      <TestModeControl
        surveyId={SURVEY_ID}
        initial={initial({ testTargetCount: 1, firstTestInviteCode: 'invite-first' })}
      />,
    );

    await user.hover(screen.getByRole('button', { name: '테스트 모드' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['테스트 링크 복사', '테스트 모드 끄기']);
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
    expect(within(menu).queryByText('테스트 대상자 생성')).not.toBeInTheDocument();

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

    await user.hover(screen.getByRole('button', { name: '테스트 모드' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: '테스트 대상자 생성' }));

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

    await user.hover(screen.getByRole('button', { name: '테스트 모드' }));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: '테스트 대상자 생성',
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

    await user.hover(screen.getByRole('button', { name: '테스트 모드' }));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: '테스트 대상자 생성',
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

    await user.hover(screen.getByRole('button', { name: '테스트 모드' }));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: '테스트 모드 끄기' }),
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
      deletedResponseCount: 0,
      deletedTargetCount: 0,
      remainingResponseCount: 3,
      remainingTargetCount: 2,
    });
    render(<TestModeControl surveyId={SURVEY_ID} initial={targetedState} />);

    await user.hover(screen.getByRole('button', { name: '테스트 모드' }));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: '테스트 모드 끄기' }),
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
        testResponseCount: 0,
        testTargetCount: 0,
        firstTestInviteCode: null,
      }),
    });
    render(<TestModeControl surveyId={SURVEY_ID} initial={targetedState} />);

    await user.hover(screen.getByRole('button', { name: '테스트 모드' }));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: '테스트 모드 끄기' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: '삭제 후 끄기' }));

    expect(controlDisableMock).toHaveBeenCalledTimes(1);
    expect(controlDisableMock).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      disposition: 'delete',
    });
    await user.click(await screen.findByRole('button', { name: '테스트 모드' }));
    expect(clipboardWrite).toHaveBeenCalledWith(
      'http://localhost:3000/survey/survey-one?test=anon-token',
    );
  });

  it('다른 관리자가 먼저 종료한 stale disable은 control을 즉시 다시 읽고 dialog를 닫는다', async () => {
    const user = userEvent.setup();
    controlDisableMock.mockRejectedValue(new Error('TEST_WORKSPACE_DISABLE_STALE'));
    controlGetMock.mockResolvedValue(initial({ testModeEnabled: false }));
    render(<TestModeControl surveyId={SURVEY_ID} initial={initial()} />);

    await user.hover(screen.getByRole('button', { name: '테스트 모드' }));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: '테스트 모드 끄기' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: '삭제 후 끄기' }));

    await waitFor(() => expect(controlGetMock).toHaveBeenCalledWith({ surveyId: SURVEY_ID }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '테스트 모드' })).not.toHaveClass('border-amber-300');
  });
});

describe('TestModeControl global state sync', () => {
  it('router refresh로 RSC initial이 바뀌면 local state도 즉시 동기화한다', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TestModeControl
        surveyId={SURVEY_ID}
        initial={initial({ testModeEnabled: false, testResponseCount: 0 })}
      />,
    );

    rerender(
      <TestModeControl
        surveyId={SURVEY_ID}
        initial={initial({ testTargetCount: 1, firstTestInviteCode: 'invite-refreshed' })}
      />,
    );
    await user.hover(screen.getByRole('button', { name: '테스트 모드' }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByText('테스트 대상자 생성')).not.toBeInTheDocument();
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

    await act(async () => resolveSecond(initial({ testModeEnabled: false })));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '테스트 모드' })).not.toHaveClass(
        'border-amber-300',
      ),
    );
    await act(async () => resolveFirst(initial()));
    expect(screen.getByRole('button', { name: '테스트 모드' })).not.toHaveClass('border-amber-300');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
