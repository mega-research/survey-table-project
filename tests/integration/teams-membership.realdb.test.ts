/**
 * 팀·멤버십 실 DB 왕복 integration test (역할 모델 v2 티켓 06).
 *
 * 단위 테스트는 순수 규칙까지만 본다. 여기서 증명하는 것은 그 규칙이 **실제 트랜잭션에서**
 * 지켜지는가다 — 부분 unique 인덱스, 마지막 팀장 가드, 직책 수정의 팀 경계(IDOR), 그리고
 * "미배치만 검색된다" 는 조건이 진짜 SQL 로 성립하는가.
 *
 * 실행 조건: DATABASE_URL 이 127.0.0.1/localhost 일 때만 (pnpm test:integration).
 */

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { teamLifecycleEvents, teamMembers, teams, users } from '@/db/schema';
import type { UserType } from '@/shared/contracts/auth';
import {
  AlreadyTeamMemberError,
  CrossTeamAssignmentError,
  DuplicateTeamNameError,
  LastTeamLeaderError,
  TeamMemberNotFoundError,
  TeamNotFoundError,
  UnassignableUserError,
} from '@/server/workspace/domain/teams';
import {
  addMember,
  changeMemberRole,
  removeMember,
  searchAssignableUsers,
  updateMemberJobTitle,
} from '@/server/workspace/services/members';
import { createTeam, getTeamDetail, listTeams } from '@/server/workspace/services/teams';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const SUPERADMIN = { isSuperadmin: true };
const LEADER = { isSuperadmin: false };

const createdUserIds: string[] = [];
const createdTeamIds: string[] = [];

/** 팀 이름은 활성 팀 안에서 유일하므로 실행마다 다른 접미사를 붙인다. */
function uniqueName(label: string): string {
  return `티켓06-${label}-${crypto.randomUUID().slice(0, 8)}`;
}

async function seedUser(
  overrides: {
    userType?: UserType;
    status?: 'active' | 'suspended';
    isSuperadmin?: boolean;
    jobTitle?: string | null;
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `ticket06-${id}@example.com`,
    emailVerified: true,
    status: overrides.status ?? 'active',
    isSuperadmin: overrides.isSuperadmin ?? false,
    userType: overrides.userType ?? 'internal',
    jobTitle: overrides.jobTitle ?? null,
  });
  createdUserIds.push(id);
  return id;
}

async function seedTeam(actorId: string, label = 'team'): Promise<string> {
  const { id } = await createTeam(actorId, { name: uniqueName(label) });
  createdTeamIds.push(id);
  return id;
}

let actorId: string;

beforeEach(async () => {
  if (!isLocalDb) return;
  actorId = await seedUser({ isSuperadmin: true });
});

afterAll(async () => {
  if (!isLocalDb) return;
  if (createdTeamIds.length > 0) {
    await db.delete(teamLifecycleEvents).where(inArray(teamLifecycleEvents.teamId, createdTeamIds));
    await db.delete(teamMembers).where(inArray(teamMembers.teamId, createdTeamIds));
    await db.delete(teams).where(inArray(teams.id, createdTeamIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

describe.skipIf(!isLocalDb)('팀 생성 (real local DB)', () => {
  it('생성은 감사 행을 함께 남긴다', async () => {
    const teamId = await seedTeam(actorId);
    const events = await db
      .select({ action: teamLifecycleEvents.action, changedBy: teamLifecycleEvents.changedBy })
      .from(teamLifecycleEvents)
      .where(eq(teamLifecycleEvents.teamId, teamId));

    expect(events).toEqual([{ action: 'create', changedBy: actorId }]);
  });

  it('같은 이름의 활성 팀은 만들 수 없다', async () => {
    const name = uniqueName('중복');
    const { id } = await createTeam(actorId, { name });
    createdTeamIds.push(id);

    await expect(createTeam(actorId, { name })).rejects.toBeInstanceOf(DuplicateTeamNameError);
  });

  it('목록은 활성 팀과 메가리서치 지표를 함께 돌려준다', async () => {
    const teamId = await seedTeam(actorId);
    const result = await listTeams();

    expect(result.teams.some((team) => team.id === teamId)).toBe(true);
    expect(result.systemSummary.teamCount).toBe(result.teams.length);
  });
});

describe.skipIf(!isLocalDb)('팀원 추가 (real local DB)', () => {
  it('미배치 internal 만 검색된다', async () => {
    const teamId = await seedTeam(actorId);
    const unassigned = await seedUser();
    const guest = await seedUser({ userType: 'guest' });
    const suspended = await seedUser({ status: 'suspended' });
    const superadmin = await seedUser({ isSuperadmin: true });
    const assigned = await seedUser();
    await addMember(SUPERADMIN, { teamId, userId: assigned, role: 'member' });

    const found = (await searchAssignableUsers({ teamId, query: 'ticket06' })).map((u) => u.userId);

    expect(found).toContain(unassigned);
    for (const excluded of [guest, suspended, superadmin, assigned]) {
      expect(found).not.toContain(excluded);
    }
  });

  it('팀장은 타 팀 active 멤버를 당겨올 수 없고, 슈퍼어드민은 겸직을 만들 수 있다', async () => {
    const teamA = await seedTeam(actorId, 'A');
    const teamB = await seedTeam(actorId, 'B');
    const userId = await seedUser();
    await addMember(SUPERADMIN, { teamId: teamA, userId, role: 'member' });

    await expect(
      addMember(LEADER, { teamId: teamB, userId, role: 'member' }),
    ).rejects.toBeInstanceOf(CrossTeamAssignmentError);

    await addMember(SUPERADMIN, { teamId: teamB, userId, role: 'member' });
    const memberships = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));
    expect(memberships).toHaveLength(2);
  });

  it('같은 팀에 두 번 넣지 않는다', async () => {
    const teamId = await seedTeam(actorId);
    const userId = await seedUser();
    await addMember(SUPERADMIN, { teamId, userId, role: 'member' });

    await expect(addMember(SUPERADMIN, { teamId, userId, role: 'member' })).rejects.toBeInstanceOf(
      AlreadyTeamMemberError,
    );
  });

  it('게스트 계정은 팀 멤버십을 가질 수 없다', async () => {
    const teamId = await seedTeam(actorId);
    const guestId = await seedUser({ userType: 'guest' });

    await expect(addMember(SUPERADMIN, { teamId, userId: guestId, role: 'member' })).rejects.toBeInstanceOf(
      UnassignableUserError,
    );
  });

  it('해산된 팀에는 아무도 넣지 않는다', async () => {
    const teamId = await seedTeam(actorId);
    const userId = await seedUser();
    // 해산 흐름 자체는 티켓 13 이지만 archived 상태의 의미는 지금부터 유효하다.
    await db.update(teams).set({ status: 'archived' }).where(eq(teams.id, teamId));

    await expect(addMember(SUPERADMIN, { teamId, userId, role: 'member' })).rejects.toBeInstanceOf(
      TeamNotFoundError,
    );

    await db.update(teams).set({ status: 'active' }).where(eq(teams.id, teamId));
  });
});

describe.skipIf(!isLocalDb)('마지막 팀장 (real local DB)', () => {
  it('혼자 남은 팀장은 강등도 제외도 되지 않는다', async () => {
    const teamId = await seedTeam(actorId);
    const leaderId = await seedUser();
    await addMember(SUPERADMIN, { teamId, userId: leaderId, role: 'leader' });

    await expect(
      changeMemberRole({ teamId, userId: leaderId, role: 'member' }),
    ).rejects.toBeInstanceOf(LastTeamLeaderError);
    await expect(removeMember({ teamId, userId: leaderId })).rejects.toBeInstanceOf(
      LastTeamLeaderError,
    );
  });

  it('팀장이 둘이면 한 명은 내려올 수 있다', async () => {
    const teamId = await seedTeam(actorId);
    const first = await seedUser();
    const second = await seedUser();
    await addMember(SUPERADMIN, { teamId, userId: first, role: 'leader' });
    await addMember(SUPERADMIN, { teamId, userId: second, role: 'leader' });

    await changeMemberRole({ teamId, userId: second, role: 'member' });

    const [row] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, second)));
    expect(row?.role).toBe('member');
  });

  it('제외된 사람은 겸직 중인 다른 팀에는 남는다', async () => {
    const teamA = await seedTeam(actorId, 'A');
    const teamB = await seedTeam(actorId, 'B');
    const userId = await seedUser();
    await addMember(SUPERADMIN, { teamId: teamA, userId, role: 'member' });
    await addMember(SUPERADMIN, { teamId: teamB, userId, role: 'member' });

    await removeMember({ teamId: teamA, userId });

    const remaining = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));
    expect(remaining).toEqual([{ teamId: teamB }]);
  });
});

describe.skipIf(!isLocalDb)('직책 수정의 팀 경계 (real local DB)', () => {
  it('그 팀 소속이 아닌 사용자의 직책은 바꿀 수 없다', async () => {
    const teamA = await seedTeam(actorId, 'A');
    const teamB = await seedTeam(actorId, 'B');
    const outsider = await seedUser({ jobTitle: '과장' });
    await addMember(SUPERADMIN, { teamId: teamB, userId: outsider, role: 'member' });

    // A팀 관리자 권한으로 통과했더라도 대상이 A팀 사람이 아니면 거부된다.
    await expect(
      updateMemberJobTitle({ teamId: teamA, userId: outsider, jobTitle: '부장' }),
    ).rejects.toBeInstanceOf(TeamMemberNotFoundError);

    const [row] = await db
      .select({ jobTitle: users.jobTitle })
      .from(users)
      .where(eq(users.id, outsider));
    expect(row?.jobTitle).toBe('과장');
  });

  it('같은 팀 사람의 직책은 바꾸고 지울 수 있다', async () => {
    const teamId = await seedTeam(actorId);
    const userId = await seedUser({ jobTitle: '연구원' });
    await addMember(SUPERADMIN, { teamId, userId, role: 'member' });

    await updateMemberJobTitle({ teamId, userId, jobTitle: '책임연구원' });
    let [row] = await db.select({ jobTitle: users.jobTitle }).from(users).where(eq(users.id, userId));
    expect(row?.jobTitle).toBe('책임연구원');

    await updateMemberJobTitle({ teamId, userId, jobTitle: null });
    [row] = await db.select({ jobTitle: users.jobTitle }).from(users).where(eq(users.id, userId));
    expect(row?.jobTitle).toBeNull();
  });
});

describe.skipIf(!isLocalDb)('팀 상세 (real local DB)', () => {
  it('소속이 아니면 존재를 알려주지 않는다', async () => {
    const teamId = await seedTeam(actorId);
    const outsider = await seedUser();

    await expect(
      getTeamDetail({ id: outsider, isSuperadmin: false }, teamId),
    ).rejects.toBeInstanceOf(TeamNotFoundError);
  });

  it('팀장은 멤버를 관리하되 팀 설정은 만지지 못한다', async () => {
    const teamId = await seedTeam(actorId);
    const leaderId = await seedUser();
    await addMember(SUPERADMIN, { teamId, userId: leaderId, role: 'leader' });

    const detail = await getTeamDetail({ id: leaderId, isSuperadmin: false }, teamId);
    expect(detail.canManageMembers).toBe(true);
    expect(detail.canManageSettings).toBe(false);
  });

  it('겸직 수를 멤버 행에 실어 준다', async () => {
    const teamA = await seedTeam(actorId, 'A');
    const teamB = await seedTeam(actorId, 'B');
    const userId = await seedUser();
    await addMember(SUPERADMIN, { teamId: teamA, userId, role: 'member' });
    await addMember(SUPERADMIN, { teamId: teamB, userId, role: 'member' });

    const detail = await getTeamDetail({ id: actorId, isSuperadmin: true }, teamA);
    const row = detail.members.find((member) => member.userId === userId);
    expect(row?.otherTeamCount).toBe(1);
  });
});
