/**
 * 비밀번호 재설정 모달 (.pen FLOW 1-3).
 *
 * 화면이 지켜야 할 것은 둘이다 — 세션 폐기 경고를 저장 전에 말하는가, 그리고 짧은 비밀번호를
 * 서버까지 보내지 않는가(전역 8자 정책은 경계 계약이 정하고 화면은 그것을 그대로 쓴다).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserListItem } from '@/shared/contracts/auth-io';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries/use-users', () => ({
  useResetUserPassword: () => ({ mutateAsync, isPending: false }),
}));

import { UserResetPasswordModal } from './user-reset-password-modal';

const onClose = vi.fn();

const USER: UserListItem = {
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

function renderModal() {
  return render(<UserResetPasswordModal user={USER} onClose={onClose} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ success: true });
});

describe('UserResetPasswordModal', () => {
  it('대상 계정과 세션 폐기 경고를 먼저 보여준다', () => {
    renderModal();
    expect(screen.getByText('김새로 · saero.kim@megaresearch.co.kr')).toBeInTheDocument();
    expect(screen.getByText('저장 즉시 이 계정의 모든 세션이 폐기됩니다.')).toBeInTheDocument();
  });

  it('이메일 재설정 링크가 없다는 것을 명시한다', () => {
    renderModal();
    expect(screen.getByText(/이메일 재설정 링크는 없습니다/)).toBeInTheDocument();
  });

  it('새 임시 비밀번호를 대상 id 와 함께 보낸다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'temp-pw-1234');
    await user.click(screen.getByRole('button', { name: '재설정' }));

    expect(mutateAsync).toHaveBeenCalledWith({ userId: USER.id, password: 'temp-pw-1234' });
    expect(onClose).toHaveBeenCalled();
  });

  it('8자 미만은 서버까지 보내지 않고 문구를 띄운다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'short7c');
    await user.click(screen.getByRole('button', { name: '재설정' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(
      await screen.findByText('비밀번호는 최소 8자 이상이어야 합니다.'),
    ).toBeInTheDocument();
  });

  it('서버 실패는 모달을 열어둔 채 문구로 보여준다', async () => {
    mutateAsync.mockRejectedValue(new Error('사용자를 찾을 수 없습니다.'));
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'temp-pw-1234');
    await user.click(screen.getByRole('button', { name: '재설정' }));

    expect(await screen.findByText('사용자를 찾을 수 없습니다.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
