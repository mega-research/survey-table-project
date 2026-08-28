/**
 * 재입사 처리 모달 (.pen FLOW 9-4 — 메일 문구 없음 버전).
 *
 * 재입사는 상태 전환·비밀번호 재설정·**팀 배정**을 한 몸으로 처리한다(ADR-0010 + 티켓 14).
 * 화면이 고정할 것은 그 한 몸이라는 사실과, 새 소속 팀이 선택이 아니라는 것이다 — 팀 없이
 * 되살리면 로그인만 되는 미배치로 돌아와 재배치 센터로 다시 흘러간다.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { selectOption } from '@tests/helpers/select';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserListItem } from '@/shared/contracts/auth-io';

import { UserRehireModal } from './user-rehire-modal';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries/use-users', () => ({
  useChangeUserStatus: () => ({ mutateAsync, isPending: false }),
}));

const TEAM_ID = '33333333-3333-4333-8333-333333333333';
const TEAM_NAME = '연구2본부 - 3팀';

vi.mock('../team-management/queries/use-teams', () => ({
  useTeams: () => ({
    data: { teams: [{ id: TEAM_ID, name: TEAM_NAME, memberCount: 2, surveyCount: 1 }] },
    isLoading: false,
    error: null,
  }),
}));

const onClose = vi.fn();

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

function renderModal(overrides: Partial<UserListItem> = {}) {
  return render(<UserRehireModal user={{ ...USER, ...overrides }} onClose={onClose} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ status: 'active' });
});

describe('UserRehireModal', () => {
  it('새 소속 팀을 고르지 않으면 서버까지 보내지 않는다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'rehire-pw-12');
    await user.click(screen.getByRole('button', { name: '재입사 처리' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    // zod 의 uuid 위반 문구를 그대로 띄우면 왜 막혔는지 알 수 없다.
    expect(await screen.findByText('새 소속 팀을 선택하세요.')).toBeInTheDocument();
  });

  it('팀에 소속될 수 없는 계정에는 팀 칸이 아예 없다', async () => {
    // 채울 수 없는 필수 칸을 보여주면 그 계정은 영영 못 돌아오는 것처럼 보인다.
    // guest·fieldwork 는 멤버십 자체가 금지고 슈퍼어드민은 팀 소속과 무관하다.
    const user = userEvent.setup();
    renderModal({ userType: 'guest' });

    expect(screen.queryByLabelText(/새 소속 팀/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/팀 역할/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'rehire-pw-12');
    await user.click(screen.getByRole('button', { name: '재입사 처리' }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: null, teamRole: null }),
    );
  });

  it('슈퍼어드민 퇴사자도 팀 없이 되살린다', () => {
    renderModal({ isSuperadmin: true });
    expect(screen.queryByLabelText(/새 소속 팀/)).not.toBeInTheDocument();
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
    await selectOption(user, /새 소속 팀/, TEAM_NAME);
    await user.click(screen.getByRole('button', { name: '재입사 처리' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      action: 'rehire',
      userId: USER.id,
      password: 'rehire-pw-12',
      jobTitle: '선임연구원',
      teamId: TEAM_ID,
      teamRole: 'member',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('지금 직책을 채워 열고 손대지 않으면 그대로 보낸다', async () => {
    // 보낸 값이 곧 저장될 값이라, 채우지 않으면 비밀번호만 입력하고 제출한 순간
    // 멀쩡한 직책이 조용히 지워진다.
    const user = userEvent.setup();
    renderModal({ jobTitle: '책임연구원' });
    expect(screen.getByLabelText('직책')).toHaveValue('책임연구원');

    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'rehire-pw-12');
    await selectOption(user, /새 소속 팀/, TEAM_NAME);
    await user.click(screen.getByRole('button', { name: '재입사 처리' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      action: 'rehire',
      userId: USER.id,
      password: 'rehire-pw-12',
      jobTitle: '책임연구원',
      teamId: TEAM_ID,
      teamRole: 'member',
    });
  });

  it('직책을 비우고 제출하면 지운다', async () => {
    const user = userEvent.setup();
    renderModal({ jobTitle: '책임연구원' });
    await user.clear(screen.getByLabelText('직책'));
    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'rehire-pw-12');
    await selectOption(user, /새 소속 팀/, TEAM_NAME);
    await user.click(screen.getByRole('button', { name: '재입사 처리' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      action: 'rehire',
      userId: USER.id,
      password: 'rehire-pw-12',
      jobTitle: undefined,
      teamId: TEAM_ID,
      teamRole: 'member',
    });
  });

  it('8자 미만 임시 비밀번호는 서버까지 보내지 않는다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'short7c');
    await user.type(screen.getByLabelText('직책'), '선임연구원');
    await selectOption(user, /새 소속 팀/, TEAM_NAME);
    await user.click(screen.getByRole('button', { name: '재입사 처리' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(await screen.findByText('비밀번호는 최소 8자 이상이어야 합니다.')).toBeInTheDocument();
  });

  it('서버 실패는 모달을 열어둔 채 문구로 보여준다', async () => {
    mutateAsync.mockRejectedValue(new Error('허용되지 않은 계정 상태 전이입니다.'));
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('새 임시 비밀번호'), 'rehire-pw-12');
    await selectOption(user, /새 소속 팀/, TEAM_NAME);
    await user.click(screen.getByRole('button', { name: '재입사 처리' }));

    expect(await screen.findByText('허용되지 않은 계정 상태 전이입니다.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
