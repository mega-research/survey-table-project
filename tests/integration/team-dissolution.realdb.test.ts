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
import { surveys as surveyProcedures } from '@/server/survey-builder/procedures/surveys';

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

/**
 * 팀 하나 + 팀원 1명 + 그룹 1개 + 그룹에 담긴 설문 1건 + **소프트 삭제된 설문 1건**.
 *
 * 삭제된 설문을 함께 두는 이유는 서비스가 일부러 `deletedAt` 필터를 걸지 않기 때문이다.
 * 거르면 그 행의 `team_id` 가 해산된 팀을 계속 가리켜 FK RESTRICT 가 훗날의 팀 행 정리를
 * 막고, 휴지통에서 되살린 설문이 없는 팀 소유로 살아난다. 시드가 없으면 그 결정을
 * 되돌려도 테스트가 초록이다.
 */
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

  const deletedSurveyId = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id: deletedSurveyId,
    title: `삭제된 설문 ${label}`,
    teamId,
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: MEMBER_ID,
    createdBy: MEMBER_ID,
    isPublic: false,
    status: 'draft',
    deletedAt: new Date(),
  });
  createdSurveyIds.push(deletedSurveyId);

  const [team] = await db
    .select({ name: teamsTable.name })
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId));

  return { teamId, teamName: team?.name ?? '', surveyId, deletedSurveyId, groupId };
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
    const { teamId, teamName, surveyId, deletedSurveyId } = await seedTeamWithWork('원자성');

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

    // 소프트 삭제된 설문도 팀을 놓는다 — 남겨두면 죽은 팀을 가리키는 FK 가 살아남는다.
    const deleted = await surveyRow(deletedSurveyId);
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.teamId).toBeNull();
    expect(deleted?.assignmentStatus).toBe('assignment_pending');

    const events = await db
      .select({ action: teamEventsTable.action, metadata: teamEventsTable.metadata })
      .from(teamEventsTable)
      .where(and(eq(teamEventsTable.teamId, teamId), eq(teamEventsTable.action, 'dissolve')));
    expect(events).toHaveLength(1);
    // 규모는 트랜잭션 안에서 잰 값이다 — 설문은 teamId 를 잃어 사후에 되짚을 수 없다.
    // surveyCount 는 **살아 있는** 1건 — 함께 움직인 삭제분은 재배치 대상이 아니라 세지 않는다.
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
    // 진 쪽은 잠금이 풀린 뒤 archived 를 보고 물러난다 — 무슨 에러든 좋은 게 아니라
    // NOT_FOUND 여야 한다. 여기서 다른 코드가 나오면 조건부 UPDATE 가 아니라 다른 이유로
    // 실패한 것이다(직렬화 오류 등).
    const rejected = results.find((r) => r.status === 'rejected');
    const reason = (rejected as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(ORPCError);
    expect(reason).toMatchObject({ code: 'NOT_FOUND' });

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

  it('해산된 팀에는 새 설문이 붙지 않는다 — 슈퍼어드민 쿠키가 남아 있어도', async () => {
    const { teamId, teamName } = await seedTeamWithWork('신규차단');

    await admin.teams.dissolve({ teamId, confirmName: teamName });

    // 슈퍼어드민의 팀 범위는 멤버십으로 걸러지지 않는다 — 해산 전 쿠키를 그대로 흉내낸다.
    const surveyClient = createRouterClient(
      { surveys: surveyProcedures },
      { context: contextFor(ADMIN_ID, true) },
    );
    await expect(
      surveyClient.surveys.create({ title: '유령이 될 뻔한 설문', scope: teamId }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('해산된 팀의 그룹은 더 이상 만질 수 없다', async () => {
    const { teamId, teamName, groupId } = await seedTeamWithWork('그룹잔여');

    await admin.teams.dissolve({ teamId, confirmName: teamName });

    // 그룹 행 자체는 감사 계보로 남지만(0107 헤더) 쓰기 경로는 닫힌다 —
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
