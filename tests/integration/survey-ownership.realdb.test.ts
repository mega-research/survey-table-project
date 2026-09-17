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
import { and, eq, inArray, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveyGroups as groupsTable,
  teamLifecycleEvents as lifecycleEventsTable,
  surveyOwnershipEvents as ownershipEventsTable,
  surveyParticipants as participantsTable,
  userStatusEvents as statusEventsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { users as userProcedures } from '@/server/auth/procedures/users';
import type { ORPCContext } from '@/server/context';
import { loadSurveyCapabilities } from '@/server/survey-access';
import { members as memberProcedures } from '@/server/workspace/procedures/members';
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
      .values({
        id: groupId,
        teamId: TEAM_A,
        name: `그룹-${groupId.slice(0, 8)}`,
        createdBy: OWNER_ID,
      });

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
    // 멤버 제외 케이스가 남긴 팀 감사도 team_id RESTRICT 라 함께 걷는다.
    await db
      .delete(lifecycleEventsTable)
      .where(inArray(lifecycleEventsTable.teamId, [TEAM_A, TEAM_B]));
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
        expectedOwnerUserId: OWNER_ID,
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
        expectedOwnerUserId: OWNER_ID,
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
        expectedOwnerUserId: OWNER_ID,
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
          expectedOwnerUserId: OWNER_ID,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('후보가 아닌 사람에게는 못 넘긴다', async () => {
      // OUTSIDER 는 B팀이고 참여자도 아니다.
      await expect(
        ownershipClient(OWNER_ID).ownership.transfer({
          surveyId,
          newOwnerUserId: OUTSIDER_ID,
          expectedOwnerUserId: OWNER_ID,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    /**
     * 티켓 체크박스의 「동시 요청 중 하나만 성공」. `FOR UPDATE` 는 두 요청을 줄 세울 뿐이라
     * 대조가 없으면 **둘 다 성공하고 나중 것이 이긴다** — 화면이 「현재 소유자: 김연구」를
     * 보고 누른 요청이 이미 바뀐 위에 그대로 얹힌다.
     */
    it('뒤늦은 이전은 거부된다 — 기대 소유자가 잠긴 값과 다르면 CONFLICT', async () => {
      await ownershipClient(OWNER_ID).ownership.transfer({
        surveyId,
        newOwnerUserId: TEAMMATE_ID,
        expectedOwnerUserId: OWNER_ID,
      });

      // 두 번째 요청은 **팀장**이 보낸다 — 옛 소유자는 이전 직후 권한을 잃어 관문에서 먼저
      // 걸리므로(FORBIDDEN) 낙관적 대조까지 도달하지 못한다. 팀장은 소유자가 누구든 권한이
      // 유지되므로 이 축을 실제로 검사할 수 있는 유일한 주체다.
      await expect(
        ownershipClient(LEADER_ID).ownership.transfer({
          surveyId,
          newOwnerUserId: LEADER_ID,
          expectedOwnerUserId: OWNER_ID, // 화면이 아직 옛 소유자를 보고 있다
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      expect((await surveyRow())?.ownerUserId).toBe(TEAMMATE_ID);
    });

    it('지금 소유자에게 다시 넘기면 CONFLICT — 아무 일도 안 하는 요청이다', async () => {
      await expect(
        ownershipClient(OWNER_ID).ownership.transfer({
          surveyId,
          newOwnerUserId: OWNER_ID,
          expectedOwnerUserId: OWNER_ID,
        }),
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
      expectedOwnerUserId: OWNER_ID,
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
      expectedOwnerUserId: OWNER_ID,
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

      await db.update(usersTable).set({ status: 'active' }).where(eq(usersTable.id, OWNER_ID));
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

      await db.update(usersTable).set({ status: 'active' }).where(eq(usersTable.id, OWNER_ID));
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

    /**
     * **승계 지정은 클라이언트 입력이다.** 예전에는 "처리자가 목록에서 고른 사람" 이라며
     * 후보 자격 재확인을 면제했는데, 그 목록을 만든 것은 서버가 아니다. 면제하면 같은 팀
     * 사람도 참여자도 아닌 임의의 active internal 계정을 지목할 수 있고, 그 사람에게 활성
     * 팀이 하나면 설문이 그 무관한 팀으로 **조용히** 따라간다 — 테넌트 귀속이 깨진다.
     */
    it('후보가 아닌 사람을 지정한 승계는 거부되고 퇴사도 롤백된다', async () => {
      // OUTSIDER 는 B팀 사람이고 이 설문의 참여자가 **아니다** — 후보 목록에 없다.
      await expect(
        usersClient(SUPERADMIN_ID).users.changeStatus({
          action: 'depart',
          userId: OWNER_ID,
          succession: [{ surveyId, newOwnerUserId: OUTSIDER_ID }],
        }),
      ).rejects.toBeTruthy();

      const [user] = await db
        .select({ status: usersTable.status })
        .from(usersTable)
        .where(eq(usersTable.id, OWNER_ID));
      expect(user?.status).toBe('active');

      const row = await surveyRow();
      expect(row?.ownerUserId).toBe(OWNER_ID);
      // 설문이 B팀으로 끌려가지 않았다는 것이 이 테스트의 요점이다.
      expect(row?.teamId).toBe(TEAM_A);
    });

  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③-b 자격 철회 경합 — 「읽고 나서 잠그는」 창을 실제로 재현한다
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 이전이 멤버십을 **읽은 뒤 잠금을 얻기 전에** 제외가 커밋되는 창.
   *
   * 목으로도, 순차 테스트로도 잡히지 않는다 — 순서를 만들어야 보이기 때문이다. 그래서 두
   * 번째 커넥션이 이전과 **같은 팀 키**(`team-members-<id>`)를 먼저 쥐고, 이전이 그 잠금에서
   * 막힌 것을 확인한 뒤 멤버십을 지우고 커밋한다.
   *
   * 잠금 뒤 재판정이 없으면 이전은 이미 읽어 둔 (사라진) 멤버십으로 커밋한다. 그렇게 만들어진
   * 설문은 소유자가 소유 팀 밖이라 **소유자조차 열지 못하고**(티켓 13 revocation), 소유자가
   * 살아 있어 승계 대기로도 잡히지 않아 재배치 인박스에도 뜨지 않는다.
   */
  describe('이전 ↔ 자격 철회 경합', () => {
    /** 이전이 팀 advisory 잠금 앞에서 대기 중인가 — 허가되지 않은 advisory 잠금으로 본다. */
    async function waitUntilBlockedOnAdvisory(budgetMs: number): Promise<void> {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        const rows = await db.execute(
          sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`,
        );
        if (Number((rows as unknown as { n: number }[])[0]?.n ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('이전이 팀 잠금에서 대기하지 않았다 — 경합 재현 실패');
    }

    it('멤버십을 읽은 뒤 잠금을 얻기 전에 제외가 커밋되면 이전이 거부된다', async () => {
      const holder = postgres(dbUrl, { prepare: false, max: 1 });
      let releaseHolder = (): void => {};
      let holderReady = (): void => {};
      const ready = new Promise<void>((resolve) => {
        holderReady = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        releaseHolder = resolve;
      });

      // 두 번째 커넥션이 팀 키를 쥔 채 대기한다 — 이전은 이 잠금 앞에서 멈춘다.
      const holderTx = holder.begin(async (h) => {
        await h`select pg_advisory_xact_lock(hashtext('team-members-' || ${TEAM_A}))`;
        holderReady();
        await gate;
        // 이전이 「읽기」와 「잠금」 사이에 있는 바로 그 순간에 자격을 철회한다.
        await h`delete from team_members where team_id = ${TEAM_A} and user_id = ${TEAMMATE_ID}`;
      });

      try {
        await ready;

        const transfer = ownershipClient(OWNER_ID).ownership.transfer({
          surveyId,
          newOwnerUserId: TEAMMATE_ID,
          expectedOwnerUserId: OWNER_ID,
        });

        await waitUntilBlockedOnAdvisory(10_000);
        releaseHolder();
        await holderTx;

        await expect(transfer).rejects.toBeTruthy();
        // 요점은 「거부됐다」가 아니라 **소유자가 팀 밖으로 나앉지 않았다** 이다.
        expect((await surveyRow())?.ownerUserId).toBe(OWNER_ID);
      } finally {
        releaseHolder();
        await holderTx.catch(() => undefined);
        await holder.end({ timeout: 5 });
        const [restored] = await db
          .select({ id: teamMembersTable.id })
          .from(teamMembersTable)
          .where(
            and(eq(teamMembersTable.teamId, TEAM_A), eq(teamMembersTable.userId, TEAMMATE_ID)),
          );
        if (!restored) {
          await db
            .insert(teamMembersTable)
            .values({ teamId: TEAM_A, userId: TEAMMATE_ID, role: 'member' });
        }
      }
    }, 30_000);

    /**
     * **잠금 순서 자체를 못 박는다** — 이전은 팀을 기다리는 동안 설문 행을 쥐고 있으면 안 된다.
     *
     * 해산(`dissolveTeam`)·재배치(`assignSurveys`)가 「팀 명부 → 팀 행 → 설문 행」으로 잠근다.
     * 이전만 「설문 행 → 팀」이면 그 둘과 정확히 반대라 겹치는 순간 데드락이고, 운영자에게는
     * 이유 없는 실패로 보인다. 순서는 주석으로 지켜지지 않으므로 여기서 관측한다.
     *
     * 관측 방법: 팀 잠금을 다른 커넥션이 쥐고 있어 이전이 멈춘 그 순간, 제3의 커넥션이 설문
     * 행을 `FOR UPDATE NOWAIT` 로 집어 본다. 순서가 옳으면 설문은 아직 안 잠겨 있어 집히고,
     * 뒤집혀 있으면 `55P03`(lock_not_available)으로 튕긴다.
     */
    it('팀 잠금을 기다리는 동안 설문 행을 쥐고 있지 않다 — 해산·재배치와 같은 순서', async () => {
      const holder = postgres(dbUrl, { prepare: false, max: 1 });
      const prober = postgres(dbUrl, { prepare: false, max: 1 });
      let releaseHolder = (): void => {};
      let holderReady = (): void => {};
      const ready = new Promise<void>((resolve) => {
        holderReady = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        releaseHolder = resolve;
      });

      const holderTx = holder.begin(async (h) => {
        await h`select pg_advisory_xact_lock(hashtext('team-members-' || ${TEAM_A}))`;
        holderReady();
        await gate;
      });

      try {
        await ready;

        const transfer = ownershipClient(OWNER_ID).ownership.transfer({
          surveyId,
          newOwnerUserId: TEAMMATE_ID,
          expectedOwnerUserId: OWNER_ID,
        });
        await waitUntilBlockedOnAdvisory(10_000);

        // 이전이 팀 잠금 앞에 멈춘 지금, 설문 행은 비어 있어야 한다.
        let surveyRowWasFree = false;
        await prober
          .begin(async (pr) => {
            await pr`select id from surveys where id = ${surveyId} for update nowait`;
            surveyRowWasFree = true;
          })
          .catch(() => {
            surveyRowWasFree = false;
          });

        releaseHolder();
        await holderTx;
        await transfer;

        expect(surveyRowWasFree).toBe(true);
        expect((await surveyRow())?.ownerUserId).toBe(TEAMMATE_ID);
      } finally {
        releaseHolder();
        await holderTx.catch(() => undefined);
        await holder.end({ timeout: 5 });
        await prober.end({ timeout: 5 });
      }
    }, 30_000);
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

  /**
   * 리뷰가 짚은 자리 — 팀이 안 바뀐 해소가 폴더 정리를 지우면 안 된다. 배치 대기(해산발)는
   * 팀이 없었으므로 언제나 미분류가 되지만, 승계 대기는 팀을 그대로 갖고 있다.
   */
  it('같은 팀으로 승계 대기를 해소하면 그룹이 남는다', async () => {
    await db
      .update(surveysTable)
      .set({ ownershipStatus: 'succession_pending' })
      .where(eq(surveysTable.id, surveyId));

    await reassignClient(SUPERADMIN_ID).reassignment.assignSurveys({
      surveyIds: [surveyId],
      teamId: TEAM_A,
      ownerUserId: TEAMMATE_ID,
      visibility: 'team',
    });

    const row = await surveyRow();
    expect(row?.ownershipStatus).toBe('normal');
    expect(row?.surveyGroupId).toBe(groupId);
  });

  it('다른 팀으로 해소하면 그룹은 미분류가 된다 — 그룹은 팀 소유물이다', async () => {
    await db
      .update(surveysTable)
      .set({ ownershipStatus: 'succession_pending' })
      .where(eq(surveysTable.id, surveyId));

    await reassignClient(SUPERADMIN_ID).reassignment.assignSurveys({
      surveyIds: [surveyId],
      teamId: TEAM_B,
      ownerUserId: OUTSIDER_ID,
      visibility: 'team',
    });

    const row = await surveyRow();
    expect(row?.teamId).toBe(TEAM_B);
    expect(row?.surveyGroupId).toBeNull();
  });

  /**
   * 소유자를 팀에서 빼면 그 설문은 소유자조차 못 여는 상태가 된다(티켓 13 revocation 계약).
   * 소유자가 살아 있어 승계 대기로도 안 잡혀 인박스에도 안 뜬다 — 입구에서 막는다.
   */
  it('소유 설문이 남은 사람은 팀에서 제외되지 않는다', async () => {
    const teamClient = createRouterClient(
      { members: memberProcedures },
      { context: contextFor(LEADER_ID) },
    );

    await expect(
      teamClient.members.remove({ teamId: TEAM_A, userId: OWNER_ID }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // 이전한 뒤에는 제외된다.
    await ownershipClient(OWNER_ID).ownership.transfer({
      surveyId,
      newOwnerUserId: TEAMMATE_ID,
      expectedOwnerUserId: OWNER_ID,
    });
    await teamClient.members.remove({ teamId: TEAM_A, userId: OWNER_ID });

    await db.insert(teamMembersTable).values({ teamId: TEAM_A, userId: OWNER_ID, role: 'member' });
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
