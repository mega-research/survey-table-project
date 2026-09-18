/**
 * 팀원 추가 모달 (.pen FLOW 7-3) — 화면이 pull 모델을 먼저 말해 주는가.
 *
 * 서버가 유일한 판정자이지만, 화면이 "미배치만" 이라고 알려주지 않으면 "타 팀 사람이 검색되지
 * 않는다" 가 버그로 읽힌다. 추가 실패(다른 팀이 먼저 데려감)의 서버 문구도 그대로 보여야 한다.
 *
 * 슈퍼어드민에게는 그 문구가 **거짓**이다(타 팀 소속자도 검색된다). 그래서 문구는
 * `canPullCrossTeam` 으로 갈리고, 후보 행은 현재 소속을 적는다 — 모르고 남의 팀 사람을
 * 당기지 않게 하는 것이 그 표기의 목적이다.
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
  teamNames: [],
};

/** 슈퍼어드민에게만 잡히는 후보 — 두 팀 겸직자다. */
const CROSS_TEAM_CANDIDATE = {
  userId: '55555555-5555-4555-8555-555555555555',
  name: '안부장',
  email: 'ahnbujang@megaresearch.co.kr',
  jobTitle: '부장',
  teamNames: ['연구 3본부 - 5팀', '연구 3본부 - 7팀'],
};

const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ success: true });
  useAssignableUsers.mockReturnValue({ data: [CANDIDATE], isLoading: false });
});

describe('MemberAddModal', () => {
  it('미배치만 검색된다는 사실을 화면이 말한다', () => {
    render(<MemberAddModal teamId={TEAM_ID} canPullCrossTeam={false} onClose={onClose} />);
    expect(screen.getByText('미배치 사용자만 검색해 추가할 수 있습니다.')).toBeInTheDocument();
    expect(
      screen.getByText(
        '타 팀 소속 멤버는 검색되지 않습니다. 이동이 필요하면 슈퍼어드민에게 요청하세요.',
      ),
    ).toBeInTheDocument();
  });

  it('후보를 추가하면 팀원 역할로 보내고 모달을 닫는다', async () => {
    const user = userEvent.setup();
    render(<MemberAddModal teamId={TEAM_ID} canPullCrossTeam={false} onClose={onClose} />);

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
    render(<MemberAddModal teamId={TEAM_ID} canPullCrossTeam={false} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '추가' }));

    expect(await screen.findByText('이미 소속 팀이 있는 사용자입니다.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('후보가 없으면 비어 있음을 알린다', () => {
    useAssignableUsers.mockReturnValue({ data: [], isLoading: false });
    render(<MemberAddModal teamId={TEAM_ID} canPullCrossTeam={false} onClose={onClose} />);
    expect(screen.getByText('추가할 수 있는 미배치 사용자가 없습니다.')).toBeInTheDocument();
  });

  it('겸직을 만들 수 있는 주체에게는 미배치 전용이라 말하지 않는다', () => {
    render(<MemberAddModal teamId={TEAM_ID} canPullCrossTeam onClose={onClose} />);

    expect(screen.queryByText('미배치 사용자만 검색해 추가할 수 있습니다.')).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        '타 팀 소속 멤버는 검색되지 않습니다. 이동이 필요하면 슈퍼어드민에게 요청하세요.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/타 팀 소속자는 겸직으로 추가됩니다/)).toBeInTheDocument();
    // 기존 소속이 남는다는 사실을 눌러보기 전에 알려야 한다 — 이동으로 오해하면 조직도가 틀어진다.
    expect(screen.getByText(/기존 소속은 그대로 남습니다/)).toBeInTheDocument();
  });

  it('후보의 현재 소속을 행에 적는다', () => {
    useAssignableUsers.mockReturnValue({ data: [CROSS_TEAM_CANDIDATE], isLoading: false });
    render(<MemberAddModal teamId={TEAM_ID} canPullCrossTeam onClose={onClose} />);

    expect(screen.getByText(/연구 3본부 - 5팀, 연구 3본부 - 7팀/)).toBeInTheDocument();
    expect(screen.queryByText(/팀 미배치/)).not.toBeInTheDocument();
  });

  it('미배치 후보는 소속 자리에 미배치라고 적는다', () => {
    render(<MemberAddModal teamId={TEAM_ID} canPullCrossTeam onClose={onClose} />);
    expect(screen.getByText(/팀 미배치/)).toBeInTheDocument();
  });
});
