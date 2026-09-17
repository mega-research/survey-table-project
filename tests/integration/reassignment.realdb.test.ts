/**
 * 재배치 센터 실 DB 왕복 (역할 모델 v2 티켓 14).
 *
 * 단위 테스트로는 볼 수 없는 것들만 여기서 본다.
 *  ① 해산이 남긴 계보를 인박스가 실제로 되짚는가 — 설문 행에서 team_id 가 지워진 뒤에도
 *     「어느 팀에서 왔는지」가 보이는 것은 survey_ownership_events 덕분이다.
 *  ② 일괄 배치가 정말 한 트랜잭션인가 — 한 건이 배치 대기가 아니면 나머지도 안 움직인다.
 *  ③ **배치된 설문의 소유자가 실제로 전권을 갖는가.** 이것이 이 티켓의 핵심 불변식이다:
 *     판정 코어의 소유자 분기는 소유 팀 소속일 때만 전권을 주므로(티켓 13), 팀 밖 사람을
 *     소유자로 앉히면 배치는 성공하는데 소유자가 자기 설문을 못 여는 설문이 만들어진다.
 *     그래서 배치 후 resolveSurveyCapabilities 를 실제로 물어본다 — 컬럼만 확인하면 이
 *     결함이 그대로 통과한다.
 *
 * 실행 조건: DATABASE_URL 이 127.0.0.1/localhost 일 때만 (pnpm test:integration).
 */
import { createRouterClient } from '@orpc/server';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveyOwnershipEvents,
  surveyGroups as surveyGroupsTable,
  surveys as surveysTable,
  teamLifecycleEvents,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import { getActiveTeamMemberships } from '@/server/read-models/team-memberships';
import { loadSurveyCapabilities } from '@/server/survey-access';
import { reassignment } from '@/server/workspace/procedures/reassignment';
import { surveyGroups } from '@/server/workspace/procedures/survey-groups';
import { teams } from '@/server/workspace/procedures/teams';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const ADMIN_ID = '9a000000-0000-4000-8000-0000000ad001';
const MEMBER_ID = '9a000000-0000-4000-8000-0000000e0001';
const OUTSIDER_ID = '9a000000-0000-4000-8000-0000000c0001';

const createdTeamIds: string[] = [];
const createdSurveyIds: string[] = [];

function contextFor(userId: string, isSuperadmin: boolean): ORPCContext {
  return {
    db: {} as never,
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: '테스터',
      status: 'active',
      isSuperadmin,
      userType: 'internal',
    },
    headers: new Headers(),
  };
}

const admin = createRouterClient(
  { reassignment, teams, surveyGroups },
  { context: contextFor(ADMIN_ID, true) },
);

async function seedUser(id: string, isSuperadmin: boolean): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(-4)}`,
    email: `reassign-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin,
    userType: 'internal',
  });
}

/** 팀 + 그 팀 소속 팀원 + 그룹에 담긴 설문 하나. 해산 대상의 전형. */
async function seedTeamWithWork(label: string, memberId = MEMBER_ID) {
  const { id: teamId } = await admin.teams.create({
    name: `재배치팀-${label}-${crypto.randomUUID().slice(0, 8)}`,
  });
  createdTeamIds.push(teamId);
  await db.insert(teamMembersTable).values({ teamId, userId: memberId, role: 'member' });

  const surveyId = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id: surveyId,
    title: `재배치 대상 ${label}`,
    teamId,
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: memberId,
    createdBy: memberId,
    isPublic: true,
    status: 'published',
  });
  createdSurveyIds.push(surveyId);

  const { id: groupId } = await admin.surveyGroups.create({ teamId, name: `그룹-${label}` });
  await admin.surveyGroups.collect({ groupId, surveyIds: [surveyId] });

  const [team] = await db
    .select({ name: teamsTable.name })
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId));

  return { teamId, teamName: team?.name ?? '', surveyId, groupId };
}

/** 살아 있는 팀 하나 — 배치의 목적지. */
async function seedDestination(label: string, memberId: string) {
  const { id: teamId } = await admin.teams.create({
    name: `목적지팀-${label}-${crypto.randomUUID().slice(0, 8)}`,
  });
  createdTeamIds.push(teamId);
  await db.insert(teamMembersTable).values({ teamId, userId: memberId, role: 'leader' });
  return teamId;
}

async function surveyRow(surveyId: string) {
  const [row] = await db
    .select({
      teamId: surveysTable.teamId,
      ownerUserId: surveysTable.ownerUserId,
      visibility: surveysTable.visibility,
      assignmentStatus: surveysTable.assignmentStatus,
      surveyGroupId: surveysTable.surveyGroupId,
    })
    .from(surveysTable)
    .where(eq(surveysTable.id, surveyId));
  return row;
}

describe.skipIf(!isLocalDb)('재배치 센터 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(ADMIN_ID, true);
    await seedUser(MEMBER_ID, false);
    await seedUser(OUTSIDER_ID, false);
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
      createdSurveyIds.length = 0;
    }
    if (createdTeamIds.length > 0) {
      await db.delete(surveyGroupsTable).where(inArray(surveyGroupsTable.teamId, createdTeamIds));
      await db
        .delete(teamLifecycleEvents)
        .where(inArray(teamLifecycleEvents.teamId, createdTeamIds));
      await db.delete(teamMembersTable).where(inArray(teamMembersTable.teamId, createdTeamIds));
      await db.delete(teamsTable).where(inArray(teamsTable.id, createdTeamIds));
      createdTeamIds.length = 0;
    }
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
    }
    if (createdTeamIds.length > 0) {
      await db.delete(surveyGroupsTable).where(inArray(surveyGroupsTable.teamId, createdTeamIds));
      await db
        .delete(teamLifecycleEvents)
        .where(inArray(teamLifecycleEvents.teamId, createdTeamIds));
      await db.delete(teamMembersTable).where(inArray(teamMembersTable.teamId, createdTeamIds));
      await db.delete(teamsTable).where(inArray(teamsTable.id, createdTeamIds));
    }
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [ADMIN_ID, MEMBER_ID, OUTSIDER_ID]));
  });

  it('해산이 만든 고아가 인박스에 뜨고 출신 팀이 보인다', async () => {
    const { teamId, teamName, surveyId } = await seedTeamWithWork('인박스');
    await admin.teams.dissolve({ teamId, confirmName: teamName });

    const inbox = await admin.reassignment.inbox();

    expect(inbox.summary.archivedTeamCount).toBeGreaterThanOrEqual(1);
    const user = inbox.unassignedUsers.find((u) => u.userId === MEMBER_ID);
    // 「이전 소속」은 해산이 team_members 행을 남긴 덕분에 읽힌다(ADR-0011).
    expect(user?.previousTeamName).toBe(teamName);

    const survey = inbox.pendingSurveys.find((s) => s.surveyId === surveyId);
    // 설문 쪽은 team_id 가 NULL 로 지워졌으므로 감사 계보에서만 되짚을 수 있다.
    expect(survey?.previousTeamName).toBe(teamName);
    expect(survey?.ownerIsUnassigned).toBe(true);
  });

  it('팀 배정이 미배치를 끝내고 직책까지 한 번에 쓴다', async () => {
    const { teamId, teamName } = await seedTeamWithWork('배정');
    await admin.teams.dissolve({ teamId, confirmName: teamName });
    const destination = await seedDestination('배정', OUTSIDER_ID);

    await admin.reassignment.assignUser({
      userId: MEMBER_ID,
      teamId: destination,
      role: 'member',
      jobTitle: '책임연구원',
    });

    expect(await getActiveTeamMemberships(MEMBER_ID)).toMatchObject([
      { teamId: destination, role: 'member' },
    ]);
    const [row] = await db
      .select({ jobTitle: usersTable.jobTitle })
      .from(usersTable)
      .where(eq(usersTable.id, MEMBER_ID));
    expect(row?.jobTitle).toBe('책임연구원');

    const inbox = await admin.reassignment.inbox();
    expect(inbox.unassignedUsers.some((u) => u.userId === MEMBER_ID)).toBe(false);
  });

  it('이미 배정된 사용자는 조용히 겸직이 되지 않고 거부된다', async () => {
    const destination = await seedDestination('겸직', OUTSIDER_ID);
    const other = await seedDestination('겸직2', OUTSIDER_ID);
    await admin.reassignment.assignUser({
      userId: MEMBER_ID,
      teamId: destination,
      role: 'member',
      jobTitle: null,
    });

    await expect(
      admin.reassignment.assignUser({
        userId: MEMBER_ID,
        teamId: other,
        role: 'member',
        jobTitle: null,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('배치가 소유·팀·공개 범위를 함께 확정하고 그룹은 미분류로 시작한다', async () => {
    const { teamId, teamName, surveyId } = await seedTeamWithWork('배치');
    await admin.teams.dissolve({ teamId, confirmName: teamName });
    const destination = await seedDestination('배치', OUTSIDER_ID);

    const result = await admin.reassignment.assignSurveys({
      surveyIds: [surveyId],
      teamId: destination,
      ownerUserId: OUTSIDER_ID,
      visibility: 'invite_only',
    });
    expect(result).toEqual({ assignedCount: 1 });

    const row = await surveyRow(surveyId);
    expect(row).toMatchObject({
      teamId: destination,
      ownerUserId: OUTSIDER_ID,
      visibility: 'invite_only',
      assignmentStatus: 'assigned',
      // 그룹은 팀 소유물이라 새 팀에서는 미분류다(티켓 12 인계).
      surveyGroupId: null,
    });

    const events = await db
      .select({ action: surveyOwnershipEvents.action, toTeamId: surveyOwnershipEvents.toTeamId })
      .from(surveyOwnershipEvents)
      .where(eq(surveyOwnershipEvents.surveyId, surveyId));
    // 해산의 unassign + 배치의 assign — 계보가 이어진다.
    expect(events.map((e) => e.action)).toEqual(['unassign', 'assign']);
    expect(events[1]?.toTeamId).toBe(destination);
  });

  it('배치된 설문의 소유자가 실제로 전권을 갖는다', async () => {
    // 이 티켓의 핵심 불변식. 판정 코어의 소유자 분기는 **소유 팀 소속일 때만** 전권을 주므로
    // (티켓 13 하드닝) 컬럼만 확인하는 테스트는 팀 밖 소유자 결함을 잡지 못한다.
    const { teamId, teamName, surveyId } = await seedTeamWithWork('전권');
    await admin.teams.dissolve({ teamId, confirmName: teamName });
    const destination = await seedDestination('전권', OUTSIDER_ID);

    await admin.reassignment.assignSurveys({
      surveyIds: [surveyId],
      teamId: destination,
      ownerUserId: OUTSIDER_ID,
      visibility: 'team',
    });

    const caps = await loadSurveyCapabilities(
      { id: OUTSIDER_ID, isSuperadmin: false, userType: 'internal' },
      surveyId,
    );
    expect(caps.has('survey.edit')).toBe(true);
    expect(caps.has('survey.delete')).toBe(true);
    expect(caps.has('export.download')).toBe(true);
  });

  it('목적지 팀 밖 사람은 소유자가 될 수 없다', async () => {
    const { teamId, teamName, surveyId } = await seedTeamWithWork('팀밖');
    await admin.teams.dissolve({ teamId, confirmName: teamName });
    const destination = await seedDestination('팀밖', OUTSIDER_ID);

    await expect(
      admin.reassignment.assignSurveys({
        surveyIds: [surveyId],
        teamId: destination,
        // MEMBER_ID 는 해산으로 미배치가 됐고 목적지 팀 소속이 아니다.
        ownerUserId: MEMBER_ID,
        visibility: 'team',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect((await surveyRow(surveyId))?.assignmentStatus).toBe('assignment_pending');
  });

  it('일괄 배치는 한 건이라도 막히면 전부 취소된다', async () => {
    const first = await seedTeamWithWork('원자성1');
    const second = await seedTeamWithWork('원자성2', OUTSIDER_ID);
    await admin.teams.dissolve({ teamId: first.teamId, confirmName: first.teamName });
    await admin.teams.dissolve({ teamId: second.teamId, confirmName: second.teamName });
    const destination = await seedDestination('원자성', OUTSIDER_ID);

    // 두 번째를 먼저 배치해 「배치 대기 아님」으로 만든다.
    await admin.reassignment.assignSurveys({
      surveyIds: [second.surveyId],
      teamId: destination,
      ownerUserId: OUTSIDER_ID,
      visibility: 'team',
    });

    await expect(
      admin.reassignment.assignSurveys({
        surveyIds: [first.surveyId, second.surveyId],
        teamId: destination,
        ownerUserId: OUTSIDER_ID,
        visibility: 'team',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // 첫 번째는 손대지 않은 채로 남는다 — 부분 성공이면 화면이 무엇이 넘어갔는지 말할 수 없다.
    expect((await surveyRow(first.surveyId))?.assignmentStatus).toBe('assignment_pending');
  });

  it('해산된 팀은 배치의 목적지가 될 수 없다', async () => {
    const { teamId, teamName, surveyId } = await seedTeamWithWork('해산목적지');
    const dead = await seedDestination('해산목적지', OUTSIDER_ID);
    const [deadTeam] = await db
      .select({ name: teamsTable.name })
      .from(teamsTable)
      .where(eq(teamsTable.id, dead));
    await admin.teams.dissolve({ teamId, confirmName: teamName });
    await admin.teams.dissolve({ teamId: dead, confirmName: deadTeam?.name ?? '' });

    await expect(
      admin.reassignment.assignSurveys({
        surveyIds: [surveyId],
        teamId: dead,
        ownerUserId: OUTSIDER_ID,
        visibility: 'team',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('배치 대기가 아닌 설문은 단건 화면에서 없는 설문과 같다', async () => {
    const { surveyId } = await seedTeamWithWork('은닉');
    // 해산하지 않았으므로 이 설문은 배치 대기가 아니다 — 존재를 알려주지 않는다.
    expect(await admin.reassignment.pendingSurvey({ surveyId })).toBeNull();
  });
});
