/**
 * 팀·멤버십 실 DB 왕복 integration test (역할 모델 v2 티켓 06).
 *
 * 단위 테스트는 순수 규칙까지만 본다. 여기서 증명하는 것은 그 규칙이 **실제 트랜잭션에서**
 * 지켜지는가다 — 부분 unique 인덱스, 마지막 팀장 가드, 직책 수정의 팀 경계(IDOR), 그리고
 * "미배치만 검색된다" 는 조건이 진짜 SQL 로 성립하는가.
 *
 * 실행 조건: DATABASE_URL 이 127.0.0.1/localhost 일 때만 (pnpm test:integration).
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
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

/** 행위자 — 감사 행의 changedBy 가 되므로 id 가 필요하다. beforeEach 가 실제 값을 심는다. */
let SUPERADMIN = { id: '', isSuperadmin: true };
let LEADER = { id: '', isSuperadmin: false };

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
    /** 정렬 검증용 — 이름순이면 어느 쪽이 먼저인지를 테스트가 정해야 한다. */
    name?: string;
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    name: overrides.name ?? `사용자-${id.slice(0, 4)}`,
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
  SUPERADMIN = { id: actorId, isSuperadmin: true };
  LEADER = { id: actorId, isSuperadmin: false };
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
  it('팀장에게는 미배치 internal 만 검색된다', async () => {
    const teamId = await seedTeam(actorId);
    const unassigned = await seedUser();
    const guest = await seedUser({ userType: 'guest' });
    const suspended = await seedUser({ status: 'suspended' });
    const superadmin = await seedUser({ isSuperadmin: true });
    const assigned = await seedUser();
    await addMember(SUPERADMIN, { teamId, userId: assigned, role: 'member' });

    const found = (await searchAssignableUsers(LEADER, { teamId, query: 'ticket06' })).map(
      (u) => u.userId,
    );

    expect(found).toContain(unassigned);
    for (const excluded of [guest, suspended, superadmin, assigned]) {
      expect(found).not.toContain(excluded);
    }
  });

  /**
   * 검색이 주체를 보지 않던 동안 슈퍼어드민은 **서버가 허용하는 겸직에 화면에서 도달할 수
   * 없었다** — 바로 아래 테스트가 `addMember(SUPERADMIN, ...)` 로 겸직을 만드는데, 그 후보가
   * 검색에 나오지 않았다. 규칙과 후보 목록이 갈린 자리다.
   */
  it('슈퍼어드민에게는 타 팀 소속자도 검색되고 소속 팀 이름이 함께 온다', async () => {
    const teamA = await seedTeam(actorId, 'A');
    const teamB = await seedTeam(actorId, 'B');
    const [nameA] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamA));
    const assigned = await seedUser();
    await addMember(SUPERADMIN, { teamId: teamA, userId: assigned, role: 'member' });

    const found = await searchAssignableUsers(SUPERADMIN, { teamId: teamB, query: 'ticket06' });
    const row = found.find((u) => u.userId === assigned);

    expect(row).toBeDefined();
    expect(row?.teamNames).toEqual([nameA!.name]);

    // 같은 후보가 팀장에게는 여전히 보이지 않는다 — 경계는 주체별로만 갈린다.
    const asLeader = await searchAssignableUsers(LEADER, { teamId: teamB, query: 'ticket06' });
    expect(asLeader.map((u) => u.userId)).not.toContain(assigned);
  });

  it('그 팀 소속자는 주체와 무관하게 후보에서 빠진다', async () => {
    const teamId = await seedTeam(actorId);
    const member = await seedUser();
    await addMember(SUPERADMIN, { teamId, userId: member, role: 'member' });

    // 누르면 AlreadyTeamMemberError 가 될 후보를 목록에 두면 안 된다.
    for (const actor of [SUPERADMIN, LEADER]) {
      const found = await searchAssignableUsers(actor, { teamId, query: 'ticket06' });
      expect(found.map((u) => u.userId)).not.toContain(member);
    }
  });

  it('슈퍼어드민 후보는 미배치가 먼저 온다', async () => {
    const teamA = await seedTeam(actorId, 'A');
    const teamB = await seedTeam(actorId, 'B');
    const suffix = crypto.randomUUID().slice(0, 8);
    // 이름순이면 소속자가 먼저다 — 그래도 미배치가 앞서야 한다(상한 20건에서 밀리지 않게).
    const assigned = await seedUser({ name: `가소속-${suffix}` });
    const unassigned = await seedUser({ name: `하미배치-${suffix}` });
    await addMember(SUPERADMIN, { teamId: teamA, userId: assigned, role: 'member' });

    const found = await searchAssignableUsers(SUPERADMIN, { teamId: teamB, query: 'ticket06' });
    const order = found
      .map((u) => u.userId)
      .filter((id) => id === assigned || id === unassigned);

    expect(order).toEqual([unassigned, assigned]);
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
      changeMemberRole(actorId, { teamId, userId: leaderId, role: 'member' }),
    ).rejects.toBeInstanceOf(LastTeamLeaderError);
    await expect(removeMember(actorId, { teamId, userId: leaderId })).rejects.toBeInstanceOf(
      LastTeamLeaderError,
    );
  });

  it('퇴사한 유일 팀장은 제외할 수 있다 — 유령 팀장에 팀이 잠기지 않는다', async () => {
    const teamId = await seedTeam(actorId);
    const leaderId = await seedUser();
    await addMember(SUPERADMIN, { teamId, userId: leaderId, role: 'leader' });
    // 계정 상태 전이 자체는 티켓 04 소관이라 여기서는 결과 상태만 만든다.
    await db.update(users).set({ status: 'departed' }).where(eq(users.id, leaderId));

    await removeMember(actorId, { teamId, userId: leaderId });

    const remaining = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId));
    expect(remaining).toEqual([]);
  });

  it('팀장이 둘이면 한 명은 내려올 수 있다', async () => {
    const teamId = await seedTeam(actorId);
    const first = await seedUser();
    const second = await seedUser();
    await addMember(SUPERADMIN, { teamId, userId: first, role: 'leader' });
    await addMember(SUPERADMIN, { teamId, userId: second, role: 'leader' });

    await changeMemberRole(actorId, { teamId, userId: second, role: 'member' });

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

    await removeMember(actorId, { teamId: teamA, userId });

    const remaining = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));
    expect(remaining).toEqual([{ teamId: teamB }]);
  });
});

describe.skipIf(!isLocalDb)('멤버 구성 감사 (real local DB)', () => {
  it('추가·역할 변경·제외가 모두 감사 행을 남긴다', async () => {
    const teamId = await seedTeam(actorId);
    const userId = await seedUser();
    const helper = await seedUser();
    // 마지막 팀장 가드에 걸리지 않도록 팀장을 하나 더 둔다.
    await addMember(SUPERADMIN, { teamId, userId: helper, role: 'leader' });

    await addMember(SUPERADMIN, { teamId, userId, role: 'member' });
    await changeMemberRole(actorId, { teamId, userId, role: 'leader' });
    await removeMember(actorId, { teamId, userId });

    const events = await db
      .select({
        action: teamLifecycleEvents.action,
        targetUserId: teamLifecycleEvents.targetUserId,
        changedBy: teamLifecycleEvents.changedBy,
        metadata: teamLifecycleEvents.metadata,
      })
      .from(teamLifecycleEvents)
      .where(
        and(
          eq(teamLifecycleEvents.teamId, teamId),
          eq(teamLifecycleEvents.targetUserId, userId),
        ),
      )
      .orderBy(asc(teamLifecycleEvents.createdAt));

    expect(events.map((event) => event.action)).toEqual([
      'member_add',
      'member_role',
      'member_remove',
    ]);
    expect(events.every((event) => event.changedBy === actorId)).toBe(true);
    // 제외된 사람의 마지막 역할은 team_members 가 사라진 뒤 여기에만 남는다.
    expect(events[2]?.metadata).toEqual({ fromRole: 'leader' });
  });

  it('역할이 그대로면 감사 행을 남기지 않는다', async () => {
    const teamId = await seedTeam(actorId);
    const userId = await seedUser();
    await addMember(SUPERADMIN, { teamId, userId, role: 'member' });

    await changeMemberRole(actorId, { teamId, userId, role: 'member' });

    const events = await db
      .select({ action: teamLifecycleEvents.action })
      .from(teamLifecycleEvents)
      .where(
        and(
          eq(teamLifecycleEvents.teamId, teamId),
          eq(teamLifecycleEvents.targetUserId, userId),
        ),
      );
    expect(events.map((event) => event.action)).toEqual(['member_add']);
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

  it('팀원은 관리 화면을 열 수 없다 (.pen 7-2 는 슈퍼어드민·팀장 화면)', async () => {
    const teamId = await seedTeam(actorId);
    const memberId = await seedUser();
    await addMember(SUPERADMIN, { teamId, userId: memberId, role: 'member' });

    await expect(
      getTeamDetail({ id: memberId, isSuperadmin: false }, teamId),
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
