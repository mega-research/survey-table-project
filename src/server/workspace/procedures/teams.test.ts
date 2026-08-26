/**
 * 팀 procedure 의 권한 축 (역할 모델 v2 티켓 06).
 *
 * 팀 관리 목록·생성·이름 변경은 조직 구조를 다루는 일이라 슈퍼어드민 전용이고(ADR-0008),
 * 상세는 팀장·팀원도 연다. 이 갈림을 여기서 고정한다 — 화면이 버튼을 감추는 것과는 별개다.
 */
import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

import { DuplicateTeamNameError, TeamNotFoundError } from '../domain/teams';
import * as svc from '../services/teams';
import { teams } from './teams';

vi.mock('../services/teams', () => ({
  listTeams: vi.fn(),
  listMyTeams: vi.fn(),
  createTeam: vi.fn(),
  renameTeam: vi.fn(),
  getTeamDetail: vi.fn(),
}));

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';

function clientWith(opts: { isSuperadmin?: boolean } = {}) {
  const context: ORPCContext = {
    db: {} as never,
    user: {
      id: ACTOR_ID,
      email: 'actor@megaresearch.co.kr',
      name: '박팀장',
      status: 'active',
      isSuperadmin: opts.isSuperadmin ?? false,
      userType: 'internal',
    },
    headers: new Headers(),
  };
  return createRouterClient({ teams }, { context });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(svc.listTeams).mockResolvedValue({
    teams: [],
    systemSummary: { teamCount: 0, surveyCount: 0 },
  });
  vi.mocked(svc.listMyTeams).mockResolvedValue([]);
  vi.mocked(svc.createTeam).mockResolvedValue({ id: TEAM_ID });
  vi.mocked(svc.renameTeam).mockResolvedValue({ success: true });
  vi.mocked(svc.getTeamDetail).mockResolvedValue({
    id: TEAM_ID,
    name: '연구1본부 - 1팀',
    description: null,
    memberCount: 0,
    surveyCount: 0,
    members: [],
    canManageMembers: true,
    canManageSettings: false,
  });
});

describe('팀 관리 표면', () => {
  it('목록·생성·이름 변경은 슈퍼어드민만', async () => {
    const client = clientWith();
    await expect(client.teams.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.teams.create({ name: '연구9본부 - 9팀' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      client.teams.rename({ teamId: TEAM_ID, name: '연구9본부 - 9팀' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.listTeams).not.toHaveBeenCalled();
    expect(svc.createTeam).not.toHaveBeenCalled();
    expect(svc.renameTeam).not.toHaveBeenCalled();
  });

  it('생성·이름 변경은 행위자 id 를 감사에 실어 위임한다', async () => {
    const client = clientWith({ isSuperadmin: true });
    await client.teams.create({ name: '연구9본부 - 9팀' });
    expect(svc.createTeam).toHaveBeenCalledWith(ACTOR_ID, { name: '연구9본부 - 9팀' });

    await client.teams.rename({ teamId: TEAM_ID, name: '연구9본부 - 8팀' });
    expect(svc.renameTeam).toHaveBeenCalledWith(ACTOR_ID, {
      teamId: TEAM_ID,
      name: '연구9본부 - 8팀',
    });
  });

  it('같은 이름의 팀은 CONFLICT', async () => {
    vi.mocked(svc.createTeam).mockRejectedValue(new DuplicateTeamNameError());
    await expect(
      clientWith({ isSuperadmin: true }).teams.create({ name: '연구1본부 - 1팀' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('팀 상세', () => {
  it('슈퍼어드민이 아니어도 열리고, 소속 판정은 서비스가 한다', async () => {
    await clientWith().teams.detail({ teamId: TEAM_ID });
    expect(svc.getTeamDetail).toHaveBeenCalledWith(
      { id: ACTOR_ID, isSuperadmin: false },
      TEAM_ID,
    );
  });

  it('남의 팀은 존재를 알려주지 않는다 (NOT_FOUND)', async () => {
    vi.mocked(svc.getTeamDetail).mockRejectedValue(new TeamNotFoundError());
    await expect(clientWith().teams.detail({ teamId: TEAM_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
