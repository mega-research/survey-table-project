/**
 * 소유권 이전 + 승계 왕복 (역할 모델 v2 티켓 19) — 실 로컬 DB.
 *
 * 이전은 **한 UPDATE 로 여러 열을 함께 움직인다** — 소유자·팀·그룹·승계 상태. 그 원자성과
 * 「소유자는 소유 팀 사람이어야 한다」(티켓 13 revocation 계약)는 SQL 로만 확인된다.
 *
 * 축 넷:
 *  ① 같은 팀 이전 — 팀·그룹은 그대로, 소유자만 바뀐다.
 *  ② 타 팀 참여자 이전 — 설문이 그 사람 팀으로 따라가고 **그룹은 미분류**가 된다(티켓 12 인계).
 *  ③ 퇴사 승계 — 제안대로 이전되거나 승계 대기로 서고, 상태 전이와 **한 트랜잭션**이다.
 *  ④ 승계 대기가 재배치 센터에서 해소된다.
 */
import { createRouterClient } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveyGroups as groupsTable,
  surveyOwnershipEvents as ownershipEventsTable,
  surveyParticipants as participantsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  userStatusEvents as statusEventsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import { users as userProcedures } from '@/server/auth/procedures/users';
import { loadSurveyCapabilities } from '@/server/survey-access';
import { ownership as ownershipProcedures } from '@/server/workspace/procedures/ownership';
import { reassignment as reassignmentProcedures } from '@/server/workspace/procedures/reassignment';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const OWNER_ID = crypto.randomUUID();
const TEAMMATE_ID = crypto.randomUUID();
const LEADER_ID = crypto.randomUUID();
/** B팀 사람 — 참여자로 초대되면 설문이 이 사람을 따라 B팀으로 간다. */
const OUTSIDER_ID = crypto.randomUUID();
const SUPERADMIN_ID = crypto.randomUUID();

const TEAM_A = crypto.randomUUID();
const TEAM_B = crypto.randomUUID();

const ALL_USERS = [OWNER_ID, TEAMMATE_ID, LEADER_ID, OUTSIDER_ID, SUPERADMIN_ID];

let surveyId = '';
let groupId = '';

function contextFor(userId: string, isSuperadmin = false): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `ownership-${userId}@example.com`,
      name: '이전테스터',
      status: 'active',
      isSuperadmin,
      userType: 'internal',
    },
  };
}

const ownershipClient = (userId: string, su = false) =>
  createRouterClient({ ownership: ownershipProcedures }, { context: contextFor(userId, su) });
const usersClient = (userId: string) =>
  createRouterClient({ users: userProcedures }, { context: contextFor(userId, true) });
const reassignClient = (userId: string) =>
  createRouterClient(
    { reassignment: reassignmentProcedures },
    { context: contextFor(userId, true) },
  );

async function seedUser(id: string, isSuperadmin = false): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `ownership-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin,
    userType: 'internal',
  });
}

async function surveyRow() {
  const [row] = await db
    .select({
      ownerUserId: surveysTable.ownerUserId,
      teamId: surveysTable.teamId,
      surveyGroupId: surveysTable.surveyGroupId,
      ownershipStatus: surveysTable.ownershipStatus,
      assignmentStatus: surveysTable.assignmentStatus,
    })
    .from(surveysTable)
    .where(eq(surveysTable.id, surveyId));
  return row;
}

async function invite(userId: string): Promise<void> {
  await db
    .insert(participantsTable)
    .values({ surveyId, userId, kind: 'member', addedBy: OWNER_ID });
}

describe.skipIf(!isLocalDb)('소유권 이전 · 승계 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    for (const id of ALL_USERS) await seedUser(id, id === SUPERADMIN_ID);
    await db.insert(teamsTable).values([
      { id: TEAM_A, name: `이전팀A-${TEAM_A.slice(0, 8)}` },
      { id: TEAM_B, name: `이전팀B-${TEAM_B.slice(0, 8)}` },
    ]);
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_A, userId: OWNER_ID, role: 'member' },
      { teamId: TEAM_A, userId: TEAMMATE_ID, role: 'member' },
      { teamId: TEAM_A, userId: LEADER_ID, role: 'leader' },
      { teamId: TEAM_B, userId: OUTSIDER_ID, role: 'member' },
    ]);
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    if (groupId) await db.delete(groupsTable).where(eq(groupsTable.id, groupId));

    groupId = crypto.randomUUID();
    await db
      .insert(groupsTable)
      .values({ id: groupId, teamId: TEAM_A, name: `그룹-${groupId.slice(0, 8)}`, createdBy: OWNER_ID });

    surveyId = crypto.randomUUID();
    await db.insert(surveysTable).values({
      id: surveyId,
      title: '이전 대상 조사',
      teamId: TEAM_A,
      surveyGroupId: groupId,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
    });
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    // 설문을 먼저 지운다 — survey_ownership_events 는 survey_id CASCADE 라 함께 사라진다.
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    if (groupId) await db.delete(groupsTable).where(eq(groupsTable.id, groupId));
    // 퇴사 케이스가 남긴 상태 감사는 user_id RESTRICT 라 손으로 걷어야 사용자가 지워진다.
    await db.delete(statusEventsTable).where(inArray(statusEventsTable.userId, ALL_USERS));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, ALL_USERS));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [TEAM_A, TEAM_B]));
    await db.delete(usersTable).where(inArray(usersTable.id, ALL_USERS));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 같은 팀 이전
  // ───────────────────────────────────────────────────────────────────────────

  describe('같은 팀 이전', () => {
    it('소유자만 바뀌고 팀·그룹은 그대로다', async () => {
      await ownershipClient(OWNER_ID).ownership.transfer({
        surveyId,
        newOwnerUserId: TEAMMATE_ID,
      });

      const row = await surveyRow();
      expect(row?.ownerUserId).toBe(TEAMMATE_ID);
      expect(row?.teamId).toBe(TEAM_A);
      // 팀이 안 움직였으므로 그룹도 그대로다 — 미분류로 떨어뜨리면 폴더 정리가 사라진다.
      expect(row?.surveyGroupId).toBe(groupId);
    });

    it('새 소유자가 전권을 얻고 옛 소유자는 팀원 수준으로 내려간다', async () => {
      await ownershipClient(OWNER_ID).ownership.transfer({
        surveyId,
        newOwnerUserId: TEAMMATE_ID,
      });

      const subject = (id: string) => ({ id, isSuperadmin: false, userType: 'internal' as const });
      const newOwner = [...(await loadSurveyCapabilities(subject(TEAMMATE_ID), surveyId))];
      const oldOwner = [...(await loadSurveyCapabilities(subject(OWNER_ID), surveyId))];

      expect(newOwner).toContain('survey.publish');
      // 팀 공개 설문이라 옛 소유자도 팀원으로는 남는다 — 다만 발행권은 잃는다.
      expect(oldOwner).toContain('survey.view');
      expect(oldOwner).not.toContain('survey.publish');
    });

    it('감사 행이 transfer 로 남는다', async () => {
      await ownershipClient(LEADER_ID).ownership.transfer({
        surveyId,
        newOwnerUserId: TEAMMATE_ID,
      });

      const [event] = await db
        .select({
          action: ownershipEventsTable.action,
          fromOwnerId: ownershipEventsTable.fromOwnerId,
          toOwnerId: ownershipEventsTable.toOwnerId,
          changedBy: ownershipEventsTable.changedBy,
        })
        .from(ownershipEventsTable)
        .where(eq(ownershipEventsTable.surveyId, surveyId));
      expect(event).toMatchObject({
        action: 'transfer',
        fromOwnerId: OWNER_ID,
        toOwnerId: TEAMMATE_ID,
        changedBy: LEADER_ID,
      });
    });

    it('참여자는 이전하지 못한다 — 설문 자체의 처분권이다', async () => {
      await invite(OUTSIDER_ID);
      await expect(
        ownershipClient(OUTSIDER_ID).ownership.transfer({
          surveyId,
          newOwnerUserId: TEAMMATE_ID,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('후보가 아닌 사람에게는 못 넘긴다', async () => {
      // OUTSIDER 는 B팀이고 참여자도 아니다.
      await expect(
        ownershipClient(OWNER_ID).ownership.transfer({
          surveyId,
          newOwnerUserId: OUTSIDER_ID,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('지금 소유자에게 다시 넘기면 CONFLICT — 아무 일도 안 하는 요청이다', async () => {
      await expect(
        ownershipClient(OWNER_ID).ownership.transfer({ surveyId, newOwnerUserId: OWNER_ID }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 타 팀 참여자 이전 — 설문이 따라간다
  // ───────────────────────────────────────────────────────────────────────────

  it('타 팀 참여자에게 넘기면 팀이 따라가고 그룹은 미분류가 된다', async () => {
    await invite(OUTSIDER_ID);

    await ownershipClient(OWNER_ID).ownership.transfer({
      surveyId,
      newOwnerUserId: OUTSIDER_ID,
    });

    const row = await surveyRow();
    expect(row?.ownerUserId).toBe(OUTSIDER_ID);
    // 소유자는 소유 팀 사람이어야 한다(티켓 13 revocation 계약) — 그래서 설문이 따라간다.
    expect(row?.teamId).toBe(TEAM_B);
    // 그룹은 팀 소유물이라 함께 갈 수 없다(티켓 12 인계).
    expect(row?.surveyGroupId).toBeNull();

    // 새 소유자가 실제로 전권을 갖는다 — 이것이 팀을 옮긴 이유다.
    const caps = [
      ...(await loadSurveyCapabilities(
        { id: OUTSIDER_ID, isSuperadmin: false, userType: 'internal' },
        surveyId,
      )),
    ];
    expect(caps).toContain('survey.publish');
  });

  it('기존 참여 부여는 이전 후에도 남는다', async () => {
    await invite(OUTSIDER_ID);
    await invite(TEAMMATE_ID);

    await ownershipClient(OWNER_ID).ownership.transfer({
      surveyId,
      newOwnerUserId: TEAMMATE_ID,
    });

    const rows = await db
      .select({ userId: participantsTable.userId })
      .from(participantsTable)
      .where(eq(participantsTable.surveyId, surveyId));
    // 새 소유자가 된 사람의 참여 행도 그대로 남는다 — 이전은 부여를 건드리지 않는다.
    expect(rows.map((r) => r.userId).sort()).toEqual([OUTSIDER_ID, TEAMMATE_ID].sort());
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 퇴사 승계 — 상태 전이와 한 트랜잭션
  // ───────────────────────────────────────────────────────────────────────────

  describe('퇴사 승계', () => {
    it('미리보기가 참여자를 먼저 제안한다 — 아무것도 바꾸지 않는다', async () => {
      await invite(OUTSIDER_ID);

      const preview = await ownershipClient(SUPERADMIN_ID, true).ownership.successionPreview({
        userId: OWNER_ID,
      });
      const plan = preview.surveys.find((s) => s.surveyId === surveyId);
      expect(plan?.proposedUserId).toBe(OUTSIDER_ID);
      expect(plan?.proposedReason).toBe('participant');

      // 미리보기는 상태를 바꾸지 않는다.
      expect((await surveyRow())?.ownerUserId).toBe(OWNER_ID);
    });

    it('참여자가 없으면 소유 팀 팀장을 제안한다', async () => {
      const preview = await ownershipClient(SUPERADMIN_ID, true).ownership.successionPreview({
        userId: OWNER_ID,
      });
      const plan = preview.surveys.find((s) => s.surveyId === surveyId);
      expect(plan?.proposedUserId).toBe(LEADER_ID);
      expect(plan?.proposedReason).toBe('team_leader');
    });

    it('퇴사가 승계를 함께 확정한다 — 상태와 소유자가 같은 트랜잭션에서 바뀐다', async () => {
      await usersClient(SUPERADMIN_ID).users.changeStatus({
        action: 'depart',
        userId: OWNER_ID,
        succession: [{ surveyId, newOwnerUserId: LEADER_ID }],
      });

      const [user] = await db
        .select({ status: usersTable.status })
        .from(usersTable)
        .where(eq(usersTable.id, OWNER_ID));
      expect(user?.status).toBe('departed');
      expect((await surveyRow())?.ownerUserId).toBe(LEADER_ID);

      await db
        .update(usersTable)
        .set({ status: 'active' })
        .where(eq(usersTable.id, OWNER_ID));
    });

    it('후임을 지정하지 않으면 승계 대기로 선다 — 소유자는 계보로 남는다', async () => {
      await usersClient(SUPERADMIN_ID).users.changeStatus({
        action: 'depart',
        userId: OWNER_ID,
        succession: [{ surveyId, newOwnerUserId: null }],
      });

      const row = await surveyRow();
      expect(row?.ownershipStatus).toBe('succession_pending');
      expect(row?.ownerUserId).toBe(OWNER_ID);
      // 팀은 그대로다 — 승계 대기는 배치 대기와 다른 축이다.
      expect(row?.teamId).toBe(TEAM_A);

      await db
        .update(usersTable)
        .set({ status: 'active' })
        .where(eq(usersTable.id, OWNER_ID));
    });

    /**
     * 화면이 보여준 목록과 서버가 대조하는 목록이 어긋나면 거부한다. 조용히 승계 대기로
     * 흘려보내면 처리자가 확인한 것과 결과가 달라지고, 그 차이는 재배치 인박스에서야 드러난다.
     */
    it('소유 설문을 빠뜨린 지정은 거부되고 퇴사도 롤백된다', async () => {
      await expect(
        usersClient(SUPERADMIN_ID).users.changeStatus({
          action: 'depart',
          userId: OWNER_ID,
          succession: [],
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const [user] = await db
        .select({ status: usersTable.status })
        .from(usersTable)
        .where(eq(usersTable.id, OWNER_ID));
      expect(user?.status).toBe('active');
      expect((await surveyRow())?.ownerUserId).toBe(OWNER_ID);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 승계 대기 해소
  // ───────────────────────────────────────────────────────────────────────────

  it('승계 대기 설문이 재배치 인박스에 서고 새 소유자 지정으로 해소된다', async () => {
    await db
      .update(surveysTable)
      .set({ ownershipStatus: 'succession_pending' })
      .where(eq(surveysTable.id, surveyId));

    const inbox = await reassignClient(SUPERADMIN_ID).reassignment.inbox();
    expect(inbox.pendingSurveys.map((s) => s.surveyId)).toContain(surveyId);

    await reassignClient(SUPERADMIN_ID).reassignment.assignSurveys({
      surveyIds: [surveyId],
      teamId: TEAM_A,
      ownerUserId: TEAMMATE_ID,
      visibility: 'team',
    });

    const row = await surveyRow();
    expect(row?.ownershipStatus).toBe('normal');
    expect(row?.ownerUserId).toBe(TEAMMATE_ID);
    expect(row?.assignmentStatus).toBe('assigned');

    const after = await reassignClient(SUPERADMIN_ID).reassignment.inbox();
    expect(after.pendingSurveys.map((s) => s.surveyId)).not.toContain(surveyId);
  });

  it('참여 행이 여럿이면 가장 먼저 초대된 사람이 제안된다', async () => {
    await invite(OUTSIDER_ID);
    // 두 번째 초대는 시각이 뒤라 제안에서 밀린다.
    await db
      .insert(participantsTable)
      .values({ surveyId, userId: TEAMMATE_ID, kind: 'member', addedBy: OWNER_ID });
    await db
      .update(participantsTable)
      .set({ createdAt: new Date(Date.now() + 60_000) })
      .where(
        and(eq(participantsTable.surveyId, surveyId), eq(participantsTable.userId, TEAMMATE_ID)),
      );

    const preview = await ownershipClient(SUPERADMIN_ID, true).ownership.successionPreview({
      userId: OWNER_ID,
    });
    expect(preview.surveys.find((s) => s.surveyId === surveyId)?.proposedUserId).toBe(OUTSIDER_ID);
  });
});
