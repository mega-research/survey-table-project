/**
 * 팀 procedure 의 권한 축 (역할 모델 v2 티켓 06).
 *
 * 팀 관리 목록·생성·이름 변경은 조직 구조를 다루는 일이라 슈퍼어드민 전용이고(ADR-0008),
 * 상세는 팀장·팀원도 연다. 이 갈림을 여기서 고정한다 — 화면이 버튼을 감추는 것과는 별개다.
 */
import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

import { DuplicateTeamNameError, TeamNameMismatchError, TeamNotFoundError } from '../domain/teams';
import * as svc from '../services/teams';
import { teams } from './teams';

vi.mock('../services/teams', () => ({
  listTeams: vi.fn(),
  createTeam: vi.fn(),
  renameTeam: vi.fn(),
  getTeamDetail: vi.fn(),
  dissolveTeam: vi.fn(),
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
  vi.mocked(svc.createTeam).mockResolvedValue({ id: TEAM_ID });
  vi.mocked(svc.renameTeam).mockResolvedValue({ success: true });
  vi.mocked(svc.getTeamDetail).mockResolvedValue({
    id: TEAM_ID,
    name: '연구1본부 - 1팀',
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
  it('슈퍼어드민이 아니어도 열리고, 자격 판정은 서비스가 한다', async () => {
    await clientWith().teams.detail({ teamId: TEAM_ID });
    expect(svc.getTeamDetail).toHaveBeenCalledWith({ id: ACTOR_ID, isSuperadmin: false }, TEAM_ID);
  });

  it('자격이 없으면 존재를 알려주지 않는다 (NOT_FOUND)', async () => {
    vi.mocked(svc.getTeamDetail).mockRejectedValue(new TeamNotFoundError());
    await expect(clientWith().teams.detail({ teamId: TEAM_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

/**
 * 팀 해산 (티켓 13, .pen FLOW 8-1).
 *
 * 여기서 고정하는 것 셋 — 슈퍼어드민 전용이라는 것, 확인 문구 대조가 **서버에** 있다는 것,
 * 그리고 **해산 취소 표면이 존재하지 않는다**는 것(ADR-0011).
 */
describe('팀 해산', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(svc.dissolveTeam).mockResolvedValue({ success: true });
  });

  it('슈퍼어드민만 해산할 수 있다 — 팀장도 못 한다', async () => {
    const member = clientWith();
    await expect(
      member.teams.dissolve({ teamId: TEAM_ID, confirmName: '연구1본부 - 1팀' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.dissolveTeam).not.toHaveBeenCalled();

    const admin = clientWith({ isSuperadmin: true });
    await admin.teams.dissolve({ teamId: TEAM_ID, confirmName: '연구1본부 - 1팀' });
    expect(svc.dissolveTeam).toHaveBeenCalledWith(ACTOR_ID, {
      teamId: TEAM_ID,
      confirmName: '연구1본부 - 1팀',
    });
  });

  it('확인 문구 불일치는 CONFLICT — 판정은 서버가 한다', async () => {
    vi.mocked(svc.dissolveTeam).mockRejectedValue(new TeamNameMismatchError());
    const admin = clientWith({ isSuperadmin: true });

    await expect(
      admin.teams.dissolve({ teamId: TEAM_ID, confirmName: '엉뚱한 이름' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: '팀 이름이 일치하지 않습니다.' });
  });

  it('이미 해산된 팀은 NOT_FOUND', async () => {
    vi.mocked(svc.dissolveTeam).mockRejectedValue(new TeamNotFoundError());
    const admin = clientWith({ isSuperadmin: true });

    await expect(
      admin.teams.dissolve({ teamId: TEAM_ID, confirmName: '연구1본부 - 1팀' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('해산 취소 표면은 존재하지 않는다 (ADR-0011)', () => {
    const surface = Object.keys(teams);
    expect(surface).toEqual(['list', 'create', 'rename', 'detail', 'dissolve']);
    expect(surface.some((k) => /restore|undo|reactivate|unarchive/i.test(k))).toBe(false);
  });
});
