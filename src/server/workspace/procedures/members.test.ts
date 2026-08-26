/**
 * 멤버십 procedure 의 관문 (역할 모델 v2 티켓 06).
 *
 * 여기서 고정하는 것은 하나다 — **팀 관리 권한은 입력의 teamId 로 판정한다**.
 * "어딘가의 팀장" 이면 통과시키는 순간 A팀 팀장이 B팀 멤버를 만질 수 있다(cross-team IDOR).
 * 서비스 내부의 대상 소속 확인은 그 다음 방어선이고, 여기는 첫 번째다.
 */
import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

import { CrossTeamAssignmentError, LastTeamLeaderError } from '../domain/teams';
import * as svc from '../services/members';
import { getTeamRole } from '@/server/read-models/team-memberships';
import { members } from './members';

vi.mock('../services/members', () => ({
  searchAssignableUsers: vi.fn(),
  addMember: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  updateMemberJobTitle: vi.fn(),
}));

vi.mock('@/server/read-models/team-memberships', () => ({ getTeamRole: vi.fn() }));

const LEADER_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_A = '22222222-2222-4222-8222-222222222222';
const TEAM_B = '33333333-3333-4333-8333-333333333333';
const TARGET_ID = '44444444-4444-4444-8444-444444444444';

function context(opts: { isSuperadmin?: boolean } = {}): ORPCContext {
  return {
    db: {} as never,
    user: {
      id: LEADER_ID,
      email: 'leader@megaresearch.co.kr',
      name: '박팀장',
      status: 'active',
      isSuperadmin: opts.isSuperadmin ?? false,
      userType: 'internal',
    },
    headers: new Headers(),
  };
}

function clientWith(opts: Parameters<typeof context>[0] = {}) {
  return createRouterClient({ members }, { context: context(opts) });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 요청자는 A팀 팀장이다 — B팀에서는 아무 역할도 없다.
  vi.mocked(getTeamRole).mockImplementation(async (_userId, teamId) =>
    teamId === TEAM_A ? 'leader' : null,
  );
  vi.mocked(svc.addMember).mockResolvedValue({ success: true });
  vi.mocked(svc.changeMemberRole).mockResolvedValue({ success: true });
  vi.mocked(svc.removeMember).mockResolvedValue({ success: true });
  vi.mocked(svc.updateMemberJobTitle).mockResolvedValue({ success: true });
  vi.mocked(svc.searchAssignableUsers).mockResolvedValue([]);
});

describe('팀 관리 관문', () => {
  it('자기 팀에서는 팀장이 멤버를 다룰 수 있다', async () => {
    await clientWith().members.add({ teamId: TEAM_A, userId: TARGET_ID, role: 'member' });
    expect(svc.addMember).toHaveBeenCalledWith(
      { id: LEADER_ID, isSuperadmin: false },
      { teamId: TEAM_A, userId: TARGET_ID, role: 'member' },
    );
  });

  it('타 팀 요청은 FORBIDDEN — 서비스에 닿지 않는다', async () => {
    const client = clientWith();
    for (const call of [
      client.members.add({ teamId: TEAM_B, userId: TARGET_ID, role: 'member' }),
      client.members.changeRole({ teamId: TEAM_B, userId: TARGET_ID, role: 'leader' }),
      client.members.remove({ teamId: TEAM_B, userId: TARGET_ID }),
      client.members.updateJobTitle({ teamId: TEAM_B, userId: TARGET_ID, jobTitle: '부장' }),
      client.members.searchAssignable({ teamId: TEAM_B, query: '' }),
    ]) {
      await expect(call).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(svc.addMember).not.toHaveBeenCalled();
    expect(svc.changeMemberRole).not.toHaveBeenCalled();
    expect(svc.removeMember).not.toHaveBeenCalled();
    expect(svc.updateMemberJobTitle).not.toHaveBeenCalled();
    expect(svc.searchAssignableUsers).not.toHaveBeenCalled();
  });

  it('팀원(팀장 아님)은 자기 팀에서도 멤버를 다룰 수 없다', async () => {
    vi.mocked(getTeamRole).mockResolvedValue('member');
    await expect(
      clientWith().members.remove({ teamId: TEAM_A, userId: TARGET_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('슈퍼어드민은 소속을 묻지 않고 모든 팀을 관리한다', async () => {
    await clientWith({ isSuperadmin: true }).members.remove({
      teamId: TEAM_B,
      userId: TARGET_ID,
    });
    expect(getTeamRole).not.toHaveBeenCalled();
    expect(svc.removeMember).toHaveBeenCalledWith(LEADER_ID, {
      teamId: TEAM_B,
      userId: TARGET_ID,
    });
  });
});

describe('도메인 에러 매핑', () => {
  it('겸직 거부와 마지막 팀장 가드는 CONFLICT 로 나간다', async () => {
    vi.mocked(svc.addMember).mockRejectedValue(new CrossTeamAssignmentError());
    await expect(
      clientWith().members.add({ teamId: TEAM_A, userId: TARGET_ID, role: 'member' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    vi.mocked(svc.removeMember).mockRejectedValue(new LastTeamLeaderError());
    await expect(
      clientWith().members.remove({ teamId: TEAM_A, userId: TARGET_ID }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
