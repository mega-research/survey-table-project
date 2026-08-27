/**
 * 팀 해산 왕복 (역할 모델 v2 티켓 13, ADR-0011) — 실 로컬 DB.
 *
 * 해산은 되돌릴 수 없고 한 트랜잭션이라, 여기서만 확인할 수 있는 것들이 있다:
 *
 * ① 팀 archived + 설문 배치 대기 + 그룹 해제 + 감사 행이 **함께** 일어난다
 * ② 확인 문구가 틀리면 **아무것도 바뀌지 않는다**
 * ③ 동시 해산이 감사 행을 둘 만들지 않는다 (advisory lock + 조건부 UPDATE)
 * ④ 팀원은 즉시 미배치가 되지만 team_members 행은 남는다 (명부 보존)
 * ⑤ **배치 대기 설문의 공개 응답 경로가 계속 돈다** — 해산의 핵심 약속이다
 */
import { createRouterClient, ORPCError } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveyGroups as surveyGroupsTable,
  surveys as surveysTable,
  teamLifecycleEvents as teamEventsTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import { getActiveTeamMemberships } from '@/server/read-models/team-memberships';
import { loadSurveyGateRow } from '@/server/survey-response/services/response-gate';
import { teams as teamProcedures } from '@/server/workspace/procedures/teams';
import { surveyGroups as groupProcedures } from '@/server/workspace/procedures/survey-groups';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const ADMIN_ID = crypto.randomUUID();
const MEMBER_ID = crypto.randomUUID();

function contextFor(userId: string, isSuperadmin: boolean): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `dissolve-${userId}@example.com`,
      name: '해산테스터',
      status: 'active',
      isSuperadmin,
      userType: 'internal',
    },
  };
}

const admin = createRouterClient(
  { teams: teamProcedures, surveyGroups: groupProcedures },
  { context: contextFor(ADMIN_ID, true) },
);

const createdTeamIds: string[] = [];
const createdSurveyIds: string[] = [];

async function seedUser(id: string, isSuperadmin: boolean): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `dissolve-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin,
    userType: 'internal',
  });
}

/** 팀 하나 + 팀원 1명 + 그룹 1개 + 그룹에 담긴 설문 1건. 해산의 전형적 대상. */
async function seedTeamWithWork(label: string) {
  const { id: teamId } = await admin.teams.create({
    name: `해산팀-${label}-${crypto.randomUUID().slice(0, 8)}`,
  });
  createdTeamIds.push(teamId);
  await db.insert(teamMembersTable).values({ teamId, userId: MEMBER_ID, role: 'member' });

  const surveyId = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id: surveyId,
    title: `해산 대상 설문 ${label}`,
    teamId,
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: MEMBER_ID,
    createdBy: MEMBER_ID,
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

async function surveyRow(surveyId: string) {
  const [row] = await db
    .select({
      teamId: surveysTable.teamId,
      assignmentStatus: surveysTable.assignmentStatus,
      surveyGroupId: surveysTable.surveyGroupId,
      deletedAt: surveysTable.deletedAt,
    })
    .from(surveysTable)
    .where(eq(surveysTable.id, surveyId));
  return row;
}

describe.skipIf(!isLocalDb)('팀 해산 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(ADMIN_ID, true);
    await seedUser(MEMBER_ID, false);
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
      createdSurveyIds.length = 0;
    }
    if (createdTeamIds.length > 0) {
      await db.delete(surveyGroupsTable).where(inArray(surveyGroupsTable.teamId, createdTeamIds));
      await db.delete(teamEventsTable).where(inArray(teamEventsTable.teamId, createdTeamIds));
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
      await db.delete(teamEventsTable).where(inArray(teamEventsTable.teamId, createdTeamIds));
      await db.delete(teamMembersTable).where(inArray(teamMembersTable.teamId, createdTeamIds));
      await db.delete(teamsTable).where(inArray(teamsTable.id, createdTeamIds));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, [ADMIN_ID, MEMBER_ID]));
  });

  it('확정 한 번에 팀·설문·그룹·감사가 함께 움직인다', async () => {
    const { teamId, teamName, surveyId } = await seedTeamWithWork('원자성');

    await admin.teams.dissolve({ teamId, confirmName: teamName });

    const [team] = await db
      .select({ status: teamsTable.status, archivedBy: teamsTable.archivedBy })
      .from(teamsTable)
      .where(eq(teamsTable.id, teamId));
    expect(team?.status).toBe('archived');
    expect(team?.archivedBy).toBe(ADMIN_ID);

    // 설문은 지워지지 않는다 — 배치 대기로 내려앉고 그룹만 풀린다.
    const survey = await surveyRow(surveyId);
    expect(survey?.deletedAt).toBeNull();
    expect(survey?.teamId).toBeNull();
    expect(survey?.assignmentStatus).toBe('assignment_pending');
    expect(survey?.surveyGroupId).toBeNull();

    const events = await db
      .select({ action: teamEventsTable.action, metadata: teamEventsTable.metadata })
      .from(teamEventsTable)
      .where(and(eq(teamEventsTable.teamId, teamId), eq(teamEventsTable.action, 'dissolve')));
    expect(events).toHaveLength(1);
    // 규모는 트랜잭션 안에서 잰 값이다 — 설문은 teamId 를 잃어 사후에 되짚을 수 없다.
    expect(events[0]?.metadata).toMatchObject({ teamName, memberCount: 1, surveyCount: 1 });
  });

  it('확인 문구가 틀리면 아무것도 바뀌지 않는다', async () => {
    const { teamId, surveyId } = await seedTeamWithWork('확인문구');

    await expect(
      admin.teams.dissolve({ teamId, confirmName: '엉뚱한 이름' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const [team] = await db
      .select({ status: teamsTable.status })
      .from(teamsTable)
      .where(eq(teamsTable.id, teamId));
    expect(team?.status).toBe('active');

    const survey = await surveyRow(surveyId);
    expect(survey?.teamId).toBe(teamId);
    expect(survey?.assignmentStatus).toBe('assigned');
    expect(survey?.surveyGroupId).not.toBeNull();

    const events = await db
      .select({ id: teamEventsTable.id })
      .from(teamEventsTable)
      .where(and(eq(teamEventsTable.teamId, teamId), eq(teamEventsTable.action, 'dissolve')));
    expect(events).toHaveLength(0);
  });

  it('동시 해산은 한 번만 기록된다 — 잠금과 조건부 UPDATE', async () => {
    const { teamId, teamName } = await seedTeamWithWork('동시');

    const results = await Promise.allSettled([
      admin.teams.dissolve({ teamId, confirmName: teamName }),
      admin.teams.dissolve({ teamId, confirmName: teamName }),
    ]);

    // 하나는 성공, 하나는 이미 해산된 팀이라 NOT_FOUND.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ORPCError);

    const events = await db
      .select({ id: teamEventsTable.id })
      .from(teamEventsTable)
      .where(and(eq(teamEventsTable.teamId, teamId), eq(teamEventsTable.action, 'dissolve')));
    expect(events).toHaveLength(1);
  });

  it('팀원은 즉시 미배치가 되지만 명부는 남는다', async () => {
    const { teamId, teamName } = await seedTeamWithWork('명부');

    expect(await getActiveTeamMemberships(MEMBER_ID)).toHaveLength(1);

    await admin.teams.dissolve({ teamId, confirmName: teamName });

    // 유효 소속 판정의 SSOT 는 archived 팀을 조인에서 뺀다 → 즉시 미배치.
    expect(await getActiveTeamMemberships(MEMBER_ID)).toHaveLength(0);

    // 그래도 행은 남는다 — 해산 시점 명부가 여기 말고는 어디에도 없다(ADR-0011).
    const rows = await db
      .select({ id: teamMembersTable.id })
      .from(teamMembersTable)
      .where(eq(teamMembersTable.teamId, teamId));
    expect(rows).toHaveLength(1);
  });

  it('배치 대기 설문의 공개 응답 경로가 계속 돈다', async () => {
    const { teamId, teamName, surveyId } = await seedTeamWithWork('응답지속');

    await admin.teams.dissolve({ teamId, confirmName: teamName });

    // 응답 게이트는 팀 컬럼을 읽지 않는다 — 해산은 응답자에게 아무 일도 아니어야 한다.
    const gate = await loadSurveyGateRow(surveyId);
    expect(gate.status).toBe('published');
    expect(gate.isPublic).toBe(true);
  });

  it('해산된 팀의 그룹은 더 이상 만질 수 없다', async () => {
    const { teamId, teamName, groupId } = await seedTeamWithWork('그룹잔여');

    await admin.teams.dissolve({ teamId, confirmName: teamName });

    // 그룹 행 자체는 감사 계보로 남지만(0090 헤더) 쓰기 경로는 닫힌다 —
    // 슈퍼어드민도 예외가 아니다.
    await expect(admin.surveyGroups.rename({ groupId, name: '되살리기' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(admin.surveyGroups.remove({ groupId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const [row] = await db
      .select({ id: surveyGroupsTable.id })
      .from(surveyGroupsTable)
      .where(eq(surveyGroupsTable.id, groupId));
    expect(row).toBeDefined();
  });
});
