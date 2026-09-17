/**
 * 팀원 추가 모달 (.pen FLOW 7-3) — 화면이 pull 모델을 먼저 말해 주는가.
 *
 * 서버가 유일한 판정자이지만, 화면이 "미배치만" 이라고 알려주지 않으면 "타 팀 사람이 검색되지
 * 않는다" 가 버그로 읽힌다. 추가 실패(다른 팀이 먼저 데려감)의 서버 문구도 그대로 보여야 한다.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutateAsync, useAssignableUsers } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  useAssignableUsers: vi.fn(),
}));

vi.mock('./queries/use-teams', () => ({
  useAddTeamMember: () => ({ mutateAsync, isPending: false }),
  useAssignableUsers,
}));

import { MemberAddModal } from './member-add-modal';

const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const CANDIDATE = {
  userId: '44444444-4444-4444-8444-444444444444',
  name: '이수민',
  email: 'sumin@megaresearch.co.kr',
  jobTitle: '연구원',
};

const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ success: true });
  useAssignableUsers.mockReturnValue({ data: [CANDIDATE], isLoading: false });
});

describe('MemberAddModal', () => {
  it('미배치만 검색된다는 사실을 화면이 말한다', () => {
    render(<MemberAddModal teamId={TEAM_ID} onClose={onClose} />);
    expect(screen.getByText('미배치 사용자만 검색해 추가할 수 있습니다.')).toBeInTheDocument();
    expect(
      screen.getByText(
        '타 팀 소속 멤버는 검색되지 않습니다. 이동이 필요하면 슈퍼어드민에게 요청하세요.',
      ),
    ).toBeInTheDocument();
  });

  it('후보를 추가하면 팀원 역할로 보내고 모달을 닫는다', async () => {
    const user = userEvent.setup();
    render(<MemberAddModal teamId={TEAM_ID} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '추가' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      userId: CANDIDATE.userId,
      role: 'member',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('서버 거부 문구를 그대로 띄우고 모달을 닫지 않는다', async () => {
    mutateAsync.mockRejectedValue(new Error('이미 소속 팀이 있는 사용자입니다.'));
    const user = userEvent.setup();
    render(<MemberAddModal teamId={TEAM_ID} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '추가' }));

    expect(await screen.findByText('이미 소속 팀이 있는 사용자입니다.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('후보가 없으면 비어 있음을 알린다', () => {
    useAssignableUsers.mockReturnValue({ data: [], isLoading: false });
    render(<MemberAddModal teamId={TEAM_ID} onClose={onClose} />);
    expect(screen.getByText('추가할 수 있는 미배치 사용자가 없습니다.')).toBeInTheDocument();
  });
});
