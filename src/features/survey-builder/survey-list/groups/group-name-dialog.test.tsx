import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupNameDialog, type GroupNameDialogTarget } from './group-name-dialog';

const createCall = vi.fn();
const renameCall = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    workspace: {
      surveyGroups: {
        create: (...a: unknown[]) => createCall(...a),
        rename: (...a: unknown[]) => renameCall(...a),
      },
    },
  },
  orpc: {},
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TEAM = '22222222-2222-4222-8222-222222222222';
const PARENT = '44444444-4444-4444-8444-444444444444';

function renderDialog(target: GroupNameDialogTarget) {
  const onClose = vi.fn();
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <GroupNameDialog target={target} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const CREATE: GroupNameDialogTarget = {
  kind: 'create-subgroup',
  teamId: TEAM,
  parent: { id: PARENT, name: '이정운' },
};

beforeEach(() => {
  createCall.mockReset();
  renameCall.mockReset();
});

describe('GroupNameDialog — 새 하위 그룹', () => {
  it('어느 그룹 안에 만드는지 말하고, 그 그룹을 상위로 실어 보낸 뒤 닫는다', async () => {
    const user = userEvent.setup();
    createCall.mockResolvedValue({ id: 'new' });
    const { onClose } = renderDialog(CREATE);

    expect(screen.getByRole('heading', { name: '새 하위 그룹' })).toBeInTheDocument();
    expect(screen.getByText(/「이정운」 안에 만듭니다/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('그룹 이름'), ' 2026 ');
    await user.click(screen.getByRole('button', { name: '만들기' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createCall).toHaveBeenCalledWith({ teamId: TEAM, name: '2026', parentGroupId: PARENT });
  });

  it('이름을 비우면 보내지 않고 이유를 적는다', async () => {
    const user = userEvent.setup();
    renderDialog(CREATE);

    await user.click(screen.getByRole('button', { name: '만들기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('그룹 이름을 입력하세요.');
    expect(createCall).not.toHaveBeenCalled();
  });

  it('서버가 거부하면 그 문구를 보이고 창을 닫지 않는다', async () => {
    const user = userEvent.setup();
    createCall.mockRejectedValue(new Error('같은 이름의 그룹이 이미 있습니다.'));
    const { onClose } = renderDialog(CREATE);

    await user.type(screen.getByLabelText('그룹 이름'), '2026');
    await user.click(screen.getByRole('button', { name: '만들기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('같은 이름의 그룹이 이미 있습니다.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('보내는 동안에는 단추가 꺼져 두 번 만들어지지 않는다', async () => {
    const user = userEvent.setup();
    let settle: (value: { id: string }) => void = () => {};
    createCall.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    renderDialog(CREATE);

    await user.type(screen.getByLabelText('그룹 이름'), '2026');
    await user.click(screen.getByRole('button', { name: '만들기' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '만들기' })).toBeDisabled());
    settle({ id: 'new' });
  });
});

describe('GroupNameDialog — 이름 바꾸기', () => {
  it('지금 이름으로 시작하고 바꾼 이름을 그 그룹에 보낸다', async () => {
    const user = userEvent.setup();
    renameCall.mockResolvedValue({ success: true });
    const { onClose } = renderDialog({ kind: 'rename', group: { id: PARENT, name: '2025' } });

    const input = screen.getByLabelText('그룹 이름');
    expect(input).toHaveValue('2025');

    await user.clear(input);
    await user.type(input, '2025 하반기');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(renameCall).toHaveBeenCalledWith({ groupId: PARENT, name: '2025 하반기' });
    expect(createCall).not.toHaveBeenCalled();
  });
});
