/**
 * 멤버 행 (.pen FLOW 7-2) — 인라인 편집이 무엇을 언제 보내는가.
 *
 * 겨누는 것은 세 가지다: 직책은 값이 실제로 바뀌었을 때만 저장되는가(포커스만 스쳐도 저장하면
 * 감사가 소음으로 찬다), 팀 경계를 강제하는 teamId 가 항상 함께 나가는가, 관리 권한이 없으면
 * 편집 자체가 잠기는가.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TeamMemberItem } from '@/shared/contracts/workspace-io';

const { changeRole, removeMember, updateJobTitle } = vi.hoisted(() => ({
  changeRole: vi.fn(),
  removeMember: vi.fn(),
  updateJobTitle: vi.fn(),
}));

vi.mock('./queries/use-teams', () => ({
  useChangeTeamMemberRole: () => ({ mutateAsync: changeRole, isPending: false }),
  useRemoveTeamMember: () => ({ mutateAsync: removeMember, isPending: false }),
  useUpdateMemberJobTitle: () => ({ mutateAsync: updateJobTitle, isPending: false }),
}));

import { TeamMemberRow } from './team-member-row';

const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER: TeamMemberItem = {
  userId: '44444444-4444-4444-8444-444444444444',
  name: '정분석',
  email: 'jung@megaresearch.co.kr',
  jobTitle: '과장',
  role: 'member',
  status: 'active',
  otherTeamCount: 1,
};

function renderRow(overrides: Partial<TeamMemberItem> = {}, canManage = true) {
  return render(
    <TeamMemberRow teamId={TEAM_ID} member={{ ...MEMBER, ...overrides }} canManage={canManage} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  changeRole.mockResolvedValue({ success: true });
  removeMember.mockResolvedValue({ success: true });
  updateJobTitle.mockResolvedValue({ success: true });
});

describe('TeamMemberRow', () => {
  it('겸직을 이메일 옆에 알린다', () => {
    renderRow();
    expect(screen.getByText(/1팀 겸직/)).toBeInTheDocument();
  });

  it('겸직이 없으면 그 표기를 붙이지 않는다', () => {
    renderRow({ otherTeamCount: 0 });
    expect(screen.queryByText(/겸직/)).not.toBeInTheDocument();
  });

  it('직책을 고쳐 포커스를 벗어나면 팀 경계와 함께 저장한다', async () => {
    const user = userEvent.setup();
    renderRow();

    const input = screen.getByLabelText('정분석 직책');
    await user.clear(input);
    await user.type(input, '부장');
    await user.tab();

    expect(updateJobTitle).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      userId: MEMBER.userId,
      jobTitle: '부장',
    });
  });

  it('직책을 비우면 null 로 지운다', async () => {
    const user = userEvent.setup();
    renderRow();

    const input = screen.getByLabelText('정분석 직책');
    await user.clear(input);
    await user.tab();

    expect(updateJobTitle).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      userId: MEMBER.userId,
      jobTitle: null,
    });
  });

  it('값이 그대로면 저장하지 않는다', async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByLabelText('정분석 직책'));
    await user.tab();

    expect(updateJobTitle).not.toHaveBeenCalled();
  });

  it('역할을 바꾸면 즉시 보낸다', async () => {
    const user = userEvent.setup();
    renderRow();

    await user.selectOptions(screen.getByLabelText('정분석 역할'), 'leader');

    expect(changeRole).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      userId: MEMBER.userId,
      role: 'leader',
    });
  });

  it('마지막 팀장 강등 거부 문구를 그대로 띄운다', async () => {
    changeRole.mockRejectedValue(new Error('마지막 팀장은 강등하거나 제외할 수 없습니다.'));
    const user = userEvent.setup();
    renderRow({ role: 'leader' });

    await user.selectOptions(screen.getByLabelText('정분석 역할'), 'member');

    expect(
      await screen.findByText('마지막 팀장은 강등하거나 제외할 수 없습니다.'),
    ).toBeInTheDocument();
  });

  it('관리 권한이 없으면 편집도 제외도 잠긴다', () => {
    renderRow({}, false);
    expect(screen.getByLabelText('정분석 직책')).toBeDisabled();
    expect(screen.getByLabelText('정분석 역할')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '제외' })).not.toBeInTheDocument();
  });

  it('제외는 확인을 거친 뒤에야 나간다', async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole('button', { name: '제외' }));
    expect(removeMember).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: '제외' }));

    expect(removeMember).toHaveBeenCalledWith({ teamId: TEAM_ID, userId: MEMBER.userId });
  });
});
