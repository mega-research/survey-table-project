/**
 * 재입사 처리 모달 (.pen FLOW 9-4 — 메일 문구 없음 버전).
 *
 * 재입사는 상태 전환과 비밀번호 재설정을 겸한다(ADR-0010). 화면이 고정할 것은 그 한 몸이라는
 * 사실과, 아직 오지 않은 팀 배정 자리를 비활성으로만 보여준다는 것이다.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserListItem } from '@/shared/contracts/auth-io';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries/use-users', () => ({
  useChangeUserStatus: () => ({ mutateAsync, isPending: false }),
}));

import { UserRehireModal } from './user-rehire-modal';

const onOpenChange = vi.fn();

const USER: UserListItem = {
  id: '55555555-5555-4555-8555-555555555555',
  name: '김퇴사',
  email: 'departed@megaresearch.co.kr',
  userType: 'internal',
  status: 'departed',
  isSuperadmin: false,
  jobTitle: null,
  organization: null,
  createdAt: '2026-08-26T00:00:00.000Z',
};

function renderModal() {
  return render(<UserRehireModal user={USER} onOpenChange={onOpenChange} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ status: 'active' });
});

describe('UserRehireModal', () => {
  it('팀 배정 자리는 노출하되 비활성이다 (티켓 06·14 에서 열림)', () => {
    renderModal();
    expect(screen.getByLabelText('새 소속 팀')).toBeDisabled();
    expect(screen.getByLabelText('팀 역할')).toBeDisabled();
    expect(screen.getByLabelText('직책')).toBeEnabled();
  });

  it('이전 멤버십을 복구하지 않는다는 것을 말한다 (ADR-0010)', () => {
    renderModal();
    expect(
      screen.getByText('이전 팀 멤버십과 설문 초대는 자동 복구하지 않습니다.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/재설정 메일은 없습니다/)).toBeInTheDocument();
  });

  it('임시 비밀번호와 직책을 rehire 로 함께 보낸다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'rehire-pw-12');
    await user.type(screen.getByLabelText('직책'), '선임연구원');
    await user.click(screen.getByRole('button', { name: '재입사 처리' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      action: 'rehire',
      userId: USER.id,
      password: 'rehire-pw-12',
      jobTitle: '선임연구원',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('비워 둔 직책은 미입력으로 접어 보낸다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'rehire-pw-12');
    await user.click(screen.getByRole('button', { name: '재입사 처리' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      action: 'rehire',
      userId: USER.id,
      password: 'rehire-pw-12',
      jobTitle: undefined,
    });
  });

  it('8자 미만 임시 비밀번호는 서버까지 보내지 않는다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'short7c');
    await user.type(screen.getByLabelText('직책'), '선임연구원');
    await user.click(screen.getByRole('button', { name: '재입사 처리' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(
      await screen.findByText('비밀번호는 최소 8자 이상이어야 합니다.'),
    ).toBeInTheDocument();
  });

  it('서버 실패는 모달을 열어둔 채 문구로 보여준다', async () => {
    mutateAsync.mockRejectedValue(new Error('허용되지 않은 계정 상태 전이입니다.'));
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'rehire-pw-12');
    await user.click(screen.getByRole('button', { name: '재입사 처리' }));

    expect(await screen.findByText('허용되지 않은 계정 상태 전이입니다.')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
