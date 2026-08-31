/**
 * 실사 초대 + 실사 홈 (역할 모델 v2 티켓 25) — 실 로컬 DB.
 *
 * **업체 둘을 심는 것이 이 스위트의 뼈대다.** 티켓의 핵심 AC 가 「타 업체 초대 설문은 잡히지
 * 않는다」이고, 그것은 조인 조건 하나에 달려 있다 — 업체를 빼면 실사 팀장의 파생 시야가 전
 * 협력사 설문으로 넘친다. 업체가 하나뿐인 시드에서는 그 조건이 있든 없든 결과가 같아서
 * 아무것도 증명하지 못한다.
 *
 * 실 DB 인 이유도 같다. 파생 시야는 `exists(... join users on ... where fieldwork_org_id = ?)`
 * 하나이고 홈 목록은 그룹 집계다 — 목이 돌려주는 행은 언제나 테스트가 정한 행이라 조인·
 * WHERE 가 무엇이든 통과한다.
 *
 * 축 다섯:
 *  ① **초대가 여는 것은 그 설문 하나뿐이다** — 초대 전엔 아무것도, 해제하면 다시 닫힌다.
 *  ② **파생 시야는 팀장 전용이고 업체가 경계다** — 실사원에게는 없고, 타 업체는 안 보인다.
 *  ③ **파생 시야는 열람 한정** — 결과코드 쓰기는 본인 초대 설문에서만.
 *  ④ **대상 자격** — 내부·게스트·비활성·종료 업체 소속은 초대되지 않는다.
 *  ⑤ **추가와 해제의 권한 축이 다르다** — 추가는 접근자 누구나, 해제는 소유자·팀장·슈퍼어드민.
 */
import { createRouterClient } from '@orpc/server';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  fieldworkOrgs as orgsTable,
  surveyParticipants as participantsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import {
  listInvitedFieldworkSurveys,
  listOrgFieldworkSurveys,
} from '@/server/read-models/fieldwork-surveys';
import { loadSurveyCapabilities } from '@/server/survey-access';
import { fieldwork as fieldworkProcedures } from '@/server/workspace/procedures/fieldwork';
import type { SurveyCapability } from '@/shared/contracts/workspace';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const RUN = crypto.randomUUID().slice(0, 8);

const OWNER_ID = crypto.randomUUID();
const LEADER_ID = crypto.randomUUID();
const MEMBER_ID = crypto.randomUUID();
const SUPERADMIN_ID = crypto.randomUUID();

/** 그린리서치 — 팀장 하나, 실사원 둘. */
const GREEN_ORG = crypto.randomUUID();
const GREEN_LEADER = crypto.randomUUID();
const GREEN_WORKER = crypto.randomUUID();
const GREEN_WORKER_2 = crypto.randomUUID();
/** 블루서베이 — **대조 업체**. 여기 사람의 초대는 그린 팀장에게 보이면 안 된다. */
const BLUE_ORG = crypto.randomUUID();
const BLUE_LEADER = crypto.randomUUID();
const BLUE_WORKER = crypto.randomUUID();
/** 종료된 업체 — 소속 계정은 초대 후보에 서지 않는다. */
const CLOSED_ORG = crypto.randomUUID();
const CLOSED_WORKER = crypto.randomUUID();
/** 초대 불가 대조군 — 게스트·비활성 실사. */
const GUEST_ID = crypto.randomUUID();
const SUSPENDED_WORKER = crypto.randomUUID();

const TEAM_ID = crypto.randomUUID();

const FIELDWORK_USER_IDS = [
  GREEN_LEADER,
  GREEN_WORKER,
  GREEN_WORKER_2,
  BLUE_LEADER,
  BLUE_WORKER,
  CLOSED_WORKER,
  SUSPENDED_WORKER,
];
const INTERNAL_USER_IDS = [OWNER_ID, LEADER_ID, MEMBER_ID, SUPERADMIN_ID, GUEST_ID];
const ALL_ORG_IDS = [GREEN_ORG, BLUE_ORG, CLOSED_ORG];

/** 내부가 만든 설문 셋 — 그린이 뛰는 것, 블루가 뛰는 것, 아무도 안 뛰는 것. */
let greenSurveyId = '';
let blueSurveyId = '';
let idleSurveyId = '';

function contextFor(userId: string, isSuperadmin = false): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `fw-invite-${userId}@example.com`,
      name: '초대테스터',
      status: 'active',
      isSuperadmin,
      userType: 'internal',
    },
    headers: new Headers(),
  };
}

const clientFor = (userId: string, isSuperadmin = false) =>
  createRouterClient(
    { fieldwork: fieldworkProcedures },
    { context: contextFor(userId, isSuperadmin) },
  );

const worker = (id: string) => ({ id, isSuperadmin: false, userType: 'fieldwork' as const });

async function caps(userId: string, surveyId: string): Promise<SurveyCapability[]> {
  return [...(await loadSurveyCapabilities(worker(userId), surveyId))].sort();
}

async function seedUser(
  id: string,
  over: {
    userType?: 'internal' | 'guest' | 'fieldwork';
    status?: 'active' | 'suspended';
    isSuperadmin?: boolean;
    orgId?: string;
    role?: 'leader' | 'worker';
  } = {},
): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `fw-invite-${id}@example.com`,
    emailVerified: true,
    status: over.status ?? 'active',
    isSuperadmin: over.isSuperadmin ?? false,
    userType: over.userType ?? 'internal',
    ...(over.orgId ? { fieldworkOrgId: over.orgId, fieldworkRole: over.role ?? 'worker' } : {}),
  });
}

async function seedSurvey(title: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id,
    title,
    teamId: TEAM_ID,
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: OWNER_ID,
    createdBy: OWNER_ID,
  });
  return id;
}

/** 초대 행을 직접 심는다 — 관문을 지나지 않는 시드용(권한 축은 ⑤가 따로 잰다). */
async function invite(surveyId: string, userId: string): Promise<void> {
  await db.insert(participantsTable).values({
    surveyId,
    userId,
    kind: 'fieldwork',
    addedBy: OWNER_ID,
  });
}

describe.skipIf(!isLocalDb)('실사 초대 · 실사 홈 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(OWNER_ID);
    await seedUser(LEADER_ID);
    await seedUser(MEMBER_ID);
    await seedUser(SUPERADMIN_ID, { isSuperadmin: true });
    await seedUser(GUEST_ID, { userType: 'guest' });

    await db.insert(orgsTable).values([
      { id: GREEN_ORG, name: `그린리서치-${RUN}`, createdBy: OWNER_ID },
      { id: BLUE_ORG, name: `블루서베이-${RUN}`, createdBy: OWNER_ID },
      { id: CLOSED_ORG, name: `종료업체-${RUN}`, status: 'archived', createdBy: OWNER_ID },
    ]);

    await seedUser(GREEN_LEADER, { userType: 'fieldwork', orgId: GREEN_ORG, role: 'leader' });
    await seedUser(GREEN_WORKER, { userType: 'fieldwork', orgId: GREEN_ORG, role: 'worker' });
    await seedUser(GREEN_WORKER_2, { userType: 'fieldwork', orgId: GREEN_ORG, role: 'worker' });
    await seedUser(BLUE_LEADER, { userType: 'fieldwork', orgId: BLUE_ORG, role: 'leader' });
    await seedUser(BLUE_WORKER, { userType: 'fieldwork', orgId: BLUE_ORG, role: 'worker' });
    await seedUser(CLOSED_WORKER, { userType: 'fieldwork', orgId: CLOSED_ORG, role: 'worker' });
    await seedUser(SUSPENDED_WORKER, {
      userType: 'fieldwork',
      status: 'suspended',
      orgId: GREEN_ORG,
      role: 'worker',
    });

    await db.insert(teamsTable).values({ id: TEAM_ID, name: `실사초대팀-${RUN}` });
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_ID, userId: OWNER_ID, role: 'member' },
      { teamId: TEAM_ID, userId: LEADER_ID, role: 'leader' },
      { teamId: TEAM_ID, userId: MEMBER_ID, role: 'member' },
    ]);
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    const previous = [greenSurveyId, blueSurveyId, idleSurveyId].filter(Boolean);
    if (previous.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, previous));
    }
    greenSurveyId = await seedSurvey('그린이 뛰는 조사');
    blueSurveyId = await seedSurvey('블루가 뛰는 조사');
    idleSurveyId = await seedSurvey('아무도 안 뛰는 조사');
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    const surveyIds = [greenSurveyId, blueSurveyId, idleSurveyId].filter(Boolean);
    if (surveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, surveyIds));
    }
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, INTERNAL_USER_IDS));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    // 실사 계정 → 업체 → 내부 계정 순서다 — FK 가 양쪽을 서로 잡는다(티켓 24).
    await db.delete(usersTable).where(inArray(usersTable.id, FIELDWORK_USER_IDS));
    await db.delete(orgsTable).where(inArray(orgsTable.id, ALL_ORG_IDS));
    await db.delete(usersTable).where(inArray(usersTable.id, INTERNAL_USER_IDS));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 초대가 여는 것은 그 설문 하나뿐이다
  // ───────────────────────────────────────────────────────────────────────────

  describe('초대는 설문 하나만 연다', () => {
    it('초대 전에는 아무것도 열리지 않는다', async () => {
      expect(await caps(GREEN_WORKER, greenSurveyId)).toEqual([]);
      expect(await listInvitedFieldworkSurveys(GREEN_WORKER)).toEqual([]);
    });

    it('초대하면 그 설문만 열리고 이웃 설문은 그대로 닫힌다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);

      expect(await caps(GREEN_WORKER, greenSurveyId)).toEqual([
        'contacts.view',
        'contacts.writeAttempts',
        'operations.view',
        'survey.view',
      ]);
      expect(await caps(GREEN_WORKER, idleSurveyId)).toEqual([]);

      const home = await listInvitedFieldworkSurveys(GREEN_WORKER);
      expect(home.map((r) => r.surveyId)).toEqual([greenSurveyId]);
      expect(home[0]).toMatchObject({ reason: 'invited', invitedColleagueName: null });
    });

    it('해제하면 그 설문이 다시 닫힌다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);
      await clientFor(OWNER_ID).fieldwork.remove({
        surveyId: greenSurveyId,
        userId: GREEN_WORKER,
      });

      expect(await caps(GREEN_WORKER, greenSurveyId)).toEqual([]);
      expect(await listInvitedFieldworkSurveys(GREEN_WORKER)).toEqual([]);
    });

    it('초대는 팀 멤버십을 만들지 않는다 — 실사는 팀 축 밖이다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);
      const rows = await db
        .select({ id: teamMembersTable.id })
        .from(teamMembersTable)
        .where(eq(teamMembersTable.userId, GREEN_WORKER));
      expect(rows).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 파생 시야 — 팀장 전용, 업체가 경계
  // ───────────────────────────────────────────────────────────────────────────

  describe('실사 팀장의 업체 시야', () => {
    it('소속원이 초대되면 팀장은 초대 없이 열람한다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);

      expect(await caps(GREEN_LEADER, greenSurveyId)).toEqual([
        'contacts.view',
        'operations.view',
        'survey.view',
      ]);

      const org = await listOrgFieldworkSurveys(GREEN_LEADER, GREEN_ORG);
      expect(org.map((r) => r.surveyId)).toEqual([greenSurveyId]);
      expect(org[0]).toMatchObject({
        reason: 'org',
        invitedColleagueName: `사용자-${GREEN_WORKER.slice(0, 4)}`,
      });
    });

    it('**타 업체** 초대 설문은 어떤 경우에도 잡히지 않는다', async () => {
      await invite(blueSurveyId, BLUE_WORKER);

      // 그린 팀장에게는 존재조차 보이지 않는다 — 파생 시야의 경계가 업체다(ADR-0019).
      expect(await caps(GREEN_LEADER, blueSurveyId)).toEqual([]);
      expect(await listOrgFieldworkSurveys(GREEN_LEADER, GREEN_ORG)).toEqual([]);

      // 대칭 확인 — 블루 팀장에게는 보인다. 이 대비가 없으면 「업체로 걸렀다」가 아니라
      // 「아무것도 안 보였다」로도 초록이 된다.
      expect(await caps(BLUE_LEADER, blueSurveyId)).toEqual([
        'contacts.view',
        'operations.view',
        'survey.view',
      ]);
      expect((await listOrgFieldworkSurveys(BLUE_LEADER, BLUE_ORG)).map((r) => r.surveyId)).toEqual(
        [blueSurveyId],
      );
    });

    it('실사원에게는 파생 시야가 없다 — 소속원이 초대돼도 닫혀 있다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);
      expect(await caps(GREEN_WORKER_2, greenSurveyId)).toEqual([]);
    });

    it('내 초대가 있으면 업체 목록에서도 「초대됨」으로 선다', async () => {
      // 내 초대가 곧 결과코드·대행 권한이라, 「업체 시야」로 그리면 할 수 있는 일을 축소해
      // 말하게 된다. 소속원도 함께 초대돼 있는 상황에서 그 우선순위를 본다.
      await invite(greenSurveyId, GREEN_LEADER);
      await invite(greenSurveyId, GREEN_WORKER);

      const org = await listOrgFieldworkSurveys(GREEN_LEADER, GREEN_ORG);
      expect(org).toHaveLength(1);
      expect(org[0]).toMatchObject({ reason: 'invited', invitedColleagueName: null });
    });

    it('한 설문에 소속원이 여럿이어도 줄은 하나다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);
      await invite(greenSurveyId, GREEN_WORKER_2);
      expect(await listOrgFieldworkSurveys(GREEN_LEADER, GREEN_ORG)).toHaveLength(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 파생 시야는 열람 한정
  // ───────────────────────────────────────────────────────────────────────────

  describe('결과코드 쓰기는 본인 초대 설문에서만', () => {
    it('파생 시야에는 contacts.writeAttempts 가 없고, 본인 초대에는 있다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);
      expect(await caps(GREEN_LEADER, greenSurveyId)).not.toContain('contacts.writeAttempts');

      await invite(greenSurveyId, GREEN_LEADER);
      expect(await caps(GREEN_LEADER, greenSurveyId)).toContain('contacts.writeAttempts');
    });

    it('초대돼도 열리지 않는 것 — 편집·응답 상세·메일·export·분석은 항상 차단', async () => {
      await invite(greenSurveyId, GREEN_WORKER);
      const opened = await caps(GREEN_WORKER, greenSurveyId);
      for (const blocked of [
        'survey.edit',
        'survey.publish',
        'survey.delete',
        'survey.invite',
        'survey.manageAccess',
        'responses.view',
        'contacts.manage',
        'mail.view',
        'mail.send',
        'analytics.view',
        'export.download',
        'surveyGroup.manage',
      ] as const) {
        expect(opened, `${blocked} 가 실사에게 서면 안 된다`).not.toContain(blocked);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 대상 자격
  // ───────────────────────────────────────────────────────────────────────────

  describe('초대할 수 없는 대상', () => {
    it.each([
      ['내부 계정', () => MEMBER_ID],
      ['게스트 계정', () => GUEST_ID],
      ['정지된 실사 계정', () => SUSPENDED_WORKER],
      ['종료된 업체 소속', () => CLOSED_WORKER],
    ])('%s 은 초대되지 않는다', async (_label, pick) => {
      await expect(
        clientFor(OWNER_ID).fieldwork.add({ surveyId: greenSurveyId, userId: pick() }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('같은 사람을 두 번 초대하면 CONFLICT', async () => {
      await clientFor(OWNER_ID).fieldwork.add({
        surveyId: greenSurveyId,
        userId: GREEN_WORKER,
      });
      await expect(
        clientFor(OWNER_ID).fieldwork.add({ surveyId: greenSurveyId, userId: GREEN_WORKER }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('없는 초대 해제는 NOT_FOUND — 조용한 성공이 아니다', async () => {
      await expect(
        clientFor(OWNER_ID).fieldwork.remove({ surveyId: greenSurveyId, userId: GREEN_WORKER }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('후보 검색에는 활성 업체의 활성 실사만 뜨고 업체명으로도 찾힌다', async () => {
      const all = await clientFor(OWNER_ID).fieldwork.searchCandidates({
        surveyId: greenSurveyId,
        query: '',
      });
      const ids = all.map((c) => c.userId);
      expect(ids).toContain(GREEN_WORKER);
      expect(ids).toContain(BLUE_WORKER); // 초대 후보는 업체를 가리지 않는다 — 내부가 고른다
      expect(ids).not.toContain(CLOSED_WORKER);
      expect(ids).not.toContain(SUSPENDED_WORKER);
      expect(ids).not.toContain(MEMBER_ID);
      expect(ids).not.toContain(GUEST_ID);

      const byOrg = await clientFor(OWNER_ID).fieldwork.searchCandidates({
        surveyId: greenSurveyId,
        query: `블루서베이-${RUN}`,
      });
      expect(byOrg.map((c) => c.userId).sort()).toEqual([BLUE_LEADER, BLUE_WORKER].sort());
    });

    it('이미 초대된 사람은 후보에서 빠진다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);
      const candidates = await clientFor(OWNER_ID).fieldwork.searchCandidates({
        surveyId: greenSurveyId,
        query: '',
      });
      expect(candidates.map((c) => c.userId)).not.toContain(GREEN_WORKER);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑤ 추가는 접근자 누구나, 해제는 소유자·팀장·슈퍼어드민
  // ───────────────────────────────────────────────────────────────────────────

  describe('권한 축', () => {
    it('팀 공개 설문의 팀원도 초대할 수 있다', async () => {
      await expect(
        clientFor(MEMBER_ID).fieldwork.add({ surveyId: greenSurveyId, userId: GREEN_WORKER }),
      ).resolves.toEqual({ success: true });
    });

    it('팀원은 해제하지 못한다 — 목록의 canManage 도 false 다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);

      const listed = await clientFor(MEMBER_ID).fieldwork.list({ surveyId: greenSurveyId });
      expect(listed.canManage).toBe(false);
      expect(listed.members.map((m) => m.userId)).toEqual([GREEN_WORKER]);
      // 업체명이 함께 온다 — .pen 이 사람을 업체로 구분하라고 말한다.
      expect(listed.members[0]).toMatchObject({
        orgName: `그린리서치-${RUN}`,
        fieldworkRole: 'worker',
      });

      await expect(
        clientFor(MEMBER_ID).fieldwork.remove({ surveyId: greenSurveyId, userId: GREEN_WORKER }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('소유자·팀장·슈퍼어드민은 해제할 수 있다', async () => {
      for (const [actor, isSuperadmin] of [
        [OWNER_ID, false],
        [LEADER_ID, false],
        [SUPERADMIN_ID, true],
      ] as const) {
        await invite(greenSurveyId, GREEN_WORKER);
        await expect(
          clientFor(actor, isSuperadmin).fieldwork.remove({
            surveyId: greenSurveyId,
            userId: GREEN_WORKER,
          }),
        ).resolves.toEqual({ success: true });
      }
    });

    it('접근할 수 없는 사람은 목록조차 볼 수 없다 — 존재 은닉(NOT_FOUND)', async () => {
      await expect(
        clientFor(GREEN_WORKER).fieldwork.list({ surveyId: greenSurveyId }),
      ).rejects.toBeTruthy();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑥ 홈 목록이 접근 판정과 같은 조건을 건다
  // ───────────────────────────────────────────────────────────────────────────

  describe('홈 목록은 열리지 않는 줄을 그리지 않는다', () => {
    it('삭제된 설문은 초대가 남아 있어도 목록에서 사라진다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);
      await db
        .update(surveysTable)
        .set({ deletedAt: new Date() })
        .where(eq(surveysTable.id, greenSurveyId));

      expect(await listInvitedFieldworkSurveys(GREEN_WORKER)).toEqual([]);
      // 삭제는 「없는 설문」이라 판정이 값이 아니라 not_found 로 끝난다 — 존재를 알리지 않는다.
      await expect(caps(GREEN_WORKER, greenSurveyId)).rejects.toMatchObject({
        reason: 'not_found',
      });
    });

    it('배치 대기 설문도 마찬가지다 — 팀이 정해지기 전에는 아무도 못 연다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);
      await db
        .update(surveysTable)
        .set({ teamId: null, assignmentStatus: 'assignment_pending' })
        .where(eq(surveysTable.id, greenSurveyId));

      expect(await listInvitedFieldworkSurveys(GREEN_WORKER)).toEqual([]);
      expect(await caps(GREEN_WORKER, greenSurveyId)).toEqual([]);
    });

    it('업체가 종료되면 소속 계정의 판정이 통째로 닫힌다', async () => {
      await invite(greenSurveyId, GREEN_WORKER);
      expect(await caps(GREEN_WORKER, greenSurveyId)).not.toEqual([]);

      await db
        .update(orgsTable)
        .set({ status: 'archived' })
        .where(eq(orgsTable.id, GREEN_ORG));
      try {
        // 주체 로더가 활성 업체일 때만 소속을 채운다 — 초대 행은 그대로 남아 있다.
        expect(await caps(GREEN_WORKER, greenSurveyId)).toEqual([]);
      } finally {
        await db.update(orgsTable).set({ status: 'active' }).where(eq(orgsTable.id, GREEN_ORG));
      }
    });
  });
});
