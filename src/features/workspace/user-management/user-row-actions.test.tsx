/**
 * 사용자 행 케밥 (.pen FLOW 1-1 액션 열) — 상태마다 무엇을 열고, 무엇을 서버로 보내는가.
 *
 * 여는 항목이 전이표에서 오는지가 핵심이다. 화면이 표를 따로 들면 "메뉴에는 있는데 누르면
 * CONFLICT" 가 되고, 반대로 열지 않으면 되돌릴 방법이 화면에서 사라진다.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserListItem } from '@/shared/contracts/auth-io';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries/use-users', () => ({
  useChangeUserStatus: () => ({ mutateAsync, isPending: false }),
}));

import { UserRowActions } from './user-row-actions';

const onRehire = vi.fn();
const onResetPassword = vi.fn();

const BASE: UserListItem = {
  id: '55555555-5555-4555-8555-555555555555',
  name: '김새로',
  email: 'saero.kim@megaresearch.co.kr',
  userType: 'internal',
  status: 'active',
  isSuperadmin: false,
  jobTitle: '연구원',
  organization: null,
  createdAt: '2026-08-26T00:00:00.000Z',
};

function renderActions(status: UserListItem['status'] = 'active') {
  return render(
    <UserRowActions
      user={{ ...BASE, status }}
      onRehire={onRehire}
      onResetPassword={onResetPassword}
    />,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '김새로 액션' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ status: 'suspended' });
});

describe('UserRowActions — 상태별 메뉴', () => {
  it('재직 중 행은 일시 정지와 퇴사 처리를 연다', async () => {
    const user = userEvent.setup();
    renderActions('active');
    await openMenu(user);

    expect(screen.getByRole('menuitem', { name: '일시 정지' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '퇴사 처리' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '재직 복귀' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '재입사 처리' })).not.toBeInTheDocument();
  });

  it('일시 정지 행은 재직 복귀와 퇴사 처리를 연다', async () => {
    const user = userEvent.setup();
    renderActions('suspended');
    await openMenu(user);

    expect(screen.getByRole('menuitem', { name: '재직 복귀' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '퇴사 처리' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '일시 정지' })).not.toBeInTheDocument();
  });

  it('퇴사 행은 재입사 처리만 연다 (재직 복귀 없음 — ADR-0010)', async () => {
    const user = userEvent.setup();
    renderActions('departed');
    await openMenu(user);

    expect(screen.getByRole('menuitem', { name: '재입사 처리' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '재직 복귀' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '일시 정지' })).not.toBeInTheDocument();
  });

  it('비밀번호 재설정은 상태와 무관하게 항상 있다', async () => {
    const user = userEvent.setup();
    renderActions('departed');
    await openMenu(user);
    expect(screen.getByRole('menuitem', { name: '비밀번호 재설정' })).toBeInTheDocument();
  });
});

describe('UserRowActions — 실행', () => {
  it('일시 정지는 확인을 거친 뒤에야 서버로 간다', async () => {
    const user = userEvent.setup();
    renderActions('active');
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: '일시 정지' }));

    // 확인 다이얼로그가 뜬 시점에는 아직 아무것도 보내지 않았다.
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/일시 정지할까요/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '일시 정지' }));
    expect(mutateAsync).toHaveBeenCalledWith({ action: 'suspend', userId: BASE.id });
  });

  it('취소하면 아무것도 보내지 않는다', async () => {
    const user = userEvent.setup();
    renderActions('active');
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: '퇴사 처리' }));
    await user.click(screen.getByRole('button', { name: '취소' }));

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('퇴사 확인 문구는 재입사로만 되돌릴 수 있다고 말한다', async () => {
    const user = userEvent.setup();
    renderActions('active');
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: '퇴사 처리' }));

    expect(screen.getByText(/재입사 처리가 필요하며/)).toBeInTheDocument();
  });

  it('서버가 거부하면 다이얼로그를 열어둔 채 문구를 보여준다', async () => {
    // 목록을 띄워둔 사이 다른 슈퍼어드민이 상태를 바꿨다면 열려 있던 메뉴가 낡은 것이다.
    mutateAsync.mockRejectedValue(new Error('마지막 슈퍼어드민은 일시 정지할 수 없습니다.'));
    const user = userEvent.setup();
    renderActions('active');
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: '일시 정지' }));
    await user.click(screen.getByRole('button', { name: '일시 정지' }));

    expect(
      await screen.findByText('마지막 슈퍼어드민은 일시 정지할 수 없습니다.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/일시 정지할까요/)).toBeInTheDocument();
  });

  it('재입사는 확인이 아니라 전용 모달로 넘긴다 (임시 비밀번호가 필요하다)', async () => {
    const user = userEvent.setup();
    renderActions('departed');
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: '재입사 처리' }));

    expect(onRehire).toHaveBeenCalledWith(expect.objectContaining({ id: BASE.id }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('비밀번호 재설정도 모달로 넘긴다', async () => {
    const user = userEvent.setup();
    renderActions('active');
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: '비밀번호 재설정' }));

    expect(onResetPassword).toHaveBeenCalledWith(expect.objectContaining({ id: BASE.id }));
  });
});
