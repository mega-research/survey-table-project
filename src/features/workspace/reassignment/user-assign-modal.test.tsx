/**
 * 팀 배정 모달 (.pen FLOW 8-3).
 *
 * 팀 상세의 「팀원 추가」와 대칭이지만 방향이 반대다(push). 여기서 고정할 것은 **셋을 한 번에
 * 확정한다**는 계약이다 — 팀만 넣고 직책을 따로 고치면 「팀은 들어갔는데 직책은 옛 팀 것」인
 * 절반 상태가 남고, 화면이 그 상태를 구분해 보여줄 방법이 없다.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectOption } from '@tests/helpers/select';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries/use-reassignment', () => ({
  useAssignUserToTeam: () => ({ mutateAsync, isPending: false }),
}));

const TEAM = { id: '11111111-1111-4111-8111-111111111111', name: '연구2본부 - 3팀' };

vi.mock('../team-management/queries/use-teams', () => ({
  useTeams: () => ({
    data: { teams: [{ ...TEAM, memberCount: 2, surveyCount: 1 }] },
    isLoading: false,
    error: null,
  }),
}));

import { UserAssignModal } from './user-assign-modal';

const USER = {
  userId: '22222222-2222-4222-8222-222222222222',
  name: '박도윤',
  email: 'dypark@megaresearch.co.kr',
  jobTitle: '부장',
  previousTeamName: '연구1본부 - 1팀',
};

const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ success: true });
});

describe('UserAssignModal', () => {
  it('누구를 어디서 옮기는지 먼저 말한다', () => {
    render(<UserAssignModal user={USER} onClose={onClose} />);
    expect(screen.getByText('박도윤 · 이전 연구1본부 - 1팀 (해산)')).toBeInTheDocument();
    expect(screen.getByText(/배정 즉시 active 멤버십이 생기고/)).toBeInTheDocument();
  });

  it('목적지 팀을 고르기 전에는 배정할 수 없다', () => {
    render(<UserAssignModal user={USER} onClose={onClose} />);
    expect(screen.getByRole('button', { name: '배정' })).toBeDisabled();
  });

  it('팀·역할·직책을 한 번에 보낸다', async () => {
    const user = userEvent.setup();
    render(<UserAssignModal user={USER} onClose={onClose} />);

    await selectOption(user, /목적지 팀/, TEAM.name);
    await selectOption(user, /역할/, '팀장');
    await user.click(screen.getByRole('button', { name: '배정' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      userId: USER.userId,
      teamId: TEAM.id,
      role: 'leader',
      // 지금 직책을 채워 열고 손대지 않으면 그대로 간다.
      jobTitle: '부장',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('직책을 비우면 「직책 없음」으로 보낸다', async () => {
    const user = userEvent.setup();
    render(<UserAssignModal user={USER} onClose={onClose} />);

    await user.clear(screen.getByLabelText('직책 (선택)'));
    await selectOption(user, /목적지 팀/, TEAM.name);
    await user.click(screen.getByRole('button', { name: '배정' }));

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ jobTitle: '' }));
  });

  it('서버 거부는 모달을 열어둔 채 문구로 보여준다', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValue(new Error('이미 다른 팀에 소속된 사용자입니다.'));
    render(<UserAssignModal user={USER} onClose={onClose} />);

    await selectOption(user, /목적지 팀/, TEAM.name);
    await user.click(screen.getByRole('button', { name: '배정' }));

    expect(await screen.findByText('이미 다른 팀에 소속된 사용자입니다.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
