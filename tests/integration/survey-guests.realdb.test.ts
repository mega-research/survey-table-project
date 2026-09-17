/**
 * 게스트 부여 왕복 + 음성 스위트 (역할 모델 v2 티켓 21) — 실 로컬 DB.
 *
 * 실 DB 인 이유는 참여자 스위트와 같다. 판정 입력(부여 행·탭 JSONB)을 **설문 행과 같은
 * 쿼리에서 조인해** 읽고, 후보 검색은 `not exists` 서브쿼리다 — 목이 돌려주는 행은 언제나
 * 테스트가 정한 행이라 조인·서브쿼리·WHERE 가 무엇이든 통과한다.
 *
 * 축 넷:
 *  ① **부여가 여는 것은 그 설문 하나뿐이다** — 부여 전엔 아무것도, 해제하면 다시 닫힌다.
 *  ② **탭은 설문마다 독립이다** — 같은 계정이 두 설문에 부여돼도 서로를 덮지 않는다.
 *  ③ **대상 자격** — 내부·실사·비활성 계정은 게스트로 부여되지 않고, 후보 검색에도 안 뜬다.
 *  ④ **추가와 해제의 권한 축이 다르다** — 추가는 접근자 누구나, 해제는 소유자·팀장·슈퍼어드민.
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
import { loadSurveyAccess } from '@/server/survey-access';
import { guests as guestProcedures } from '@/server/workspace/procedures/guests';
import { participants as participantProcedures } from '@/server/workspace/procedures/participants';
import {
  DEFAULT_SURVEY_GUEST_TABS,
  NO_SURVEY_GUEST_TABS,
} from '@/shared/contracts/workspace';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const OWNER_ID = crypto.randomUUID();
const LEADER_ID = crypto.randomUUID();
const MEMBER_ID = crypto.randomUUID();
const SUPERADMIN_ID = crypto.randomUUID();
/** 부여 대상 — 클라이언트 계정 둘(1계정 N설문 검증용 하나 + 대조군 하나). */
const GUEST_ID = crypto.randomUUID();
const OTHER_GUEST_ID = crypto.randomUUID();
/** 부여 불가 계정 — 유형·상태 정합 검증용. */
const FIELDWORK_ID = crypto.randomUUID();
/** 실사 대조군의 소속 업체 — 실사 계정은 소속이 없으면 행이 만들어지지 않는다(티켓 24). */
const FIELDWORK_ORG_ID = crypto.randomUUID();
const SUSPENDED_GUEST_ID = crypto.randomUUID();
/** 팀 미배치 내부 계정 — 어떤 설문에도 접근할 수 없다(CONTEXT.md 「팀 미배치 사용자」). */
const UNASSIGNED_ID = crypto.randomUUID();

const TEAM_ID = crypto.randomUUID();

const ALL_USER_IDS = [
  OWNER_ID,
  LEADER_ID,
  MEMBER_ID,
  SUPERADMIN_ID,
  GUEST_ID,
  OTHER_GUEST_ID,
  FIELDWORK_ID,
  SUSPENDED_GUEST_ID,
  UNASSIGNED_ID,
];

let surveyId = '';
let neighbourSurveyId = '';

function contextFor(userId: string, isSuperadmin = false): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `guest-grants-${userId}@example.com`,
      name: '부여테스터',
      status: 'active',
      isSuperadmin,
      userType: 'internal',
    },
  };
}

function clientFor(userId: string, isSuperadmin = false) {
  return createRouterClient(
    { guests: guestProcedures, participants: participantProcedures },
    { context: contextFor(userId, isSuperadmin) },
  );
}

async function seedUser(
  id: string,
  over: {
    userType?: 'internal' | 'guest' | 'fieldwork';
    status?: 'active' | 'suspended';
    isSuperadmin?: boolean;
    organization?: string;
  } = {},
): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `guest-grants-${id}@example.com`,
    emailVerified: true,
    status: over.status ?? 'active',
    isSuperadmin: over.isSuperadmin ?? false,
    userType: over.userType ?? 'internal',
    // 실사 계정은 소속 업체·역할이 **필수**다(0120 users_fieldwork_fields_check, 티켓 24) —
    // 이 스위트에서 실사는 「부여 대상이 아니다」를 보여주는 대조군이라 값 자체는 무의미하지만,
    // 없으면 행이 아예 만들어지지 않는다.
    ...(over.userType === 'fieldwork'
      ? { fieldworkOrgId: FIELDWORK_ORG_ID, fieldworkRole: 'worker' as const }
      : {}),
    organization: over.organization ?? null,
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

/** 게스트 주체의 판정 결과 — capability 와 탭을 함께 본다. */
async function guestAccess(id = surveyId) {
  return loadSurveyAccess({ id: GUEST_ID, isSuperadmin: false, userType: 'guest' }, id);
}

describe.skipIf(!isLocalDb)('설문 게스트 부여 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(OWNER_ID);
    await db.insert(orgsTable).values({
      id: FIELDWORK_ORG_ID,
      name: `부여대조업체-${FIELDWORK_ORG_ID.slice(0, 8)}`,
      createdBy: OWNER_ID,
    });
    await seedUser(LEADER_ID);
    await seedUser(MEMBER_ID);
    await seedUser(SUPERADMIN_ID, { isSuperadmin: true });
    await seedUser(GUEST_ID, { userType: 'guest', organization: '한국물류협회' });
    await seedUser(OTHER_GUEST_ID, { userType: 'guest' });
    await seedUser(FIELDWORK_ID, { userType: 'fieldwork' });
    await seedUser(SUSPENDED_GUEST_ID, { userType: 'guest', status: 'suspended' });
    await seedUser(UNASSIGNED_ID);

    await db.insert(teamsTable).values({ id: TEAM_ID, name: `부여팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_ID, userId: OWNER_ID, role: 'member' },
      { teamId: TEAM_ID, userId: LEADER_ID, role: 'leader' },
      { teamId: TEAM_ID, userId: MEMBER_ID, role: 'member' },
    ]);
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    if (neighbourSurveyId) {
      await db.delete(surveysTable).where(eq(surveysTable.id, neighbourSurveyId));
    }
    surveyId = await seedSurvey('클라이언트 열람 조사');
    neighbourSurveyId = await seedSurvey('같은 팀 이웃 조사');
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    await db
      .delete(surveysTable)
      .where(inArray(surveysTable.id, [surveyId, neighbourSurveyId].filter(Boolean)));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, ALL_USER_IDS));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    // 실사 계정 → 업체 → 나머지 계정 순서다. FK 가 양쪽을 서로 잡고 있다(티켓 24):
    // 실사 계정은 업체를 가리키고(fieldwork_org_id), 업체는 만든 사람을 가리킨다(created_by).
    await db.delete(usersTable).where(eq(usersTable.id, FIELDWORK_ID));
    await db.delete(orgsTable).where(eq(orgsTable.id, FIELDWORK_ORG_ID));
    await db.delete(usersTable).where(inArray(usersTable.id, ALL_USER_IDS));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 부여가 여는 것은 그 설문 하나뿐이다
  // ───────────────────────────────────────────────────────────────────────────

  describe('부여는 설문 하나만 연다', () => {
    it('부여 전에는 아무것도 열리지 않는다 — 탭도 전부 닫힌다', async () => {
      const access = await guestAccess();
      expect([...access.capabilities]).toEqual([]);
      expect(access.guestTabs).toEqual(NO_SURVEY_GUEST_TABS);
    });

    it('부여하면 그 설문만 열리고 기본 탭은 응답 현황 하나다', async () => {
      await clientFor(OWNER_ID).guests.add({ surveyId, userId: GUEST_ID });

      const access = await guestAccess();
      expect([...access.capabilities].sort()).toEqual(['operations.view', 'survey.view']);
      expect(access.guestTabs).toEqual(DEFAULT_SURVEY_GUEST_TABS);

      // 같은 팀의 다른 설문은 그대로다.
      const neighbour = await guestAccess(neighbourSurveyId);
      expect([...neighbour.capabilities]).toEqual([]);
    });

    it('해제하면 그 설문이 다시 닫힌다', async () => {
      const owner = clientFor(OWNER_ID);
      await owner.guests.add({ surveyId, userId: GUEST_ID });
      await owner.guests.remove({ surveyId, userId: GUEST_ID });

      expect([...(await guestAccess()).capabilities]).toEqual([]);
    });

    it('부여는 팀 멤버십을 만들지 않는다 — 게스트는 팀 축 밖이다', async () => {
      await clientFor(OWNER_ID).guests.add({ surveyId, userId: GUEST_ID });
      const rows = await db
        .select({ id: teamMembersTable.id })
        .from(teamMembersTable)
        .where(eq(teamMembersTable.userId, GUEST_ID));
      expect(rows).toEqual([]);
    });

    it('참여자 제외 버튼이 게스트 부여를 지우지 않는다 — kind 조건이 걸려 있다', async () => {
      // 두 블록이 같은 테이블을 쓰므로 WHERE 의 kind 가 유일한 칸막이다. 조건이 빠지면
      // 한 블록의 「제외」가 다른 블록의 목록을 비운다.
      const owner = clientFor(OWNER_ID);
      await owner.guests.add({ surveyId, userId: GUEST_ID });

      await expect(
        owner.participants.remove({ surveyId, userId: GUEST_ID }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const rows = await db
        .select({ kind: participantsTable.kind })
        .from(participantsTable)
        .where(eq(participantsTable.surveyId, surveyId));
      expect(rows).toEqual([{ kind: 'guest' }]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 탭은 설문마다 독립이다
  // ───────────────────────────────────────────────────────────────────────────

  describe('탭 화이트리스트는 설문마다 따로 산다', () => {
    it('한 계정이 두 설문에 부여되면 탭이 서로를 덮지 않는다', async () => {
      const owner = clientFor(OWNER_ID);
      await owner.guests.add({ surveyId, userId: GUEST_ID });
      await owner.guests.add({ surveyId: neighbourSurveyId, userId: GUEST_ID });

      await owner.guests.setTabs({
        surveyId,
        userId: GUEST_ID,
        tabs: { overview: false, progressReport: true, contactsMasked: true, quota: false },
      });

      expect((await guestAccess()).guestTabs).toEqual({
        overview: false,
        progressReport: true,
        contactsMasked: true,
        quota: false,
      });
      // 이웃 설문은 기본값 그대로다.
      expect((await guestAccess(neighbourSurveyId)).guestTabs).toEqual(DEFAULT_SURVEY_GUEST_TABS);
    });

    it('한 설문의 두 게스트도 서로를 덮지 않는다', async () => {
      const owner = clientFor(OWNER_ID);
      await owner.guests.add({ surveyId, userId: GUEST_ID });
      await owner.guests.add({ surveyId, userId: OTHER_GUEST_ID });
      await owner.guests.setTabs({
        surveyId,
        userId: GUEST_ID,
        tabs: { overview: true, progressReport: true, contactsMasked: true, quota: true },
      });

      const list = await owner.guests.list({ surveyId });
      const byId = new Map(list.guests.map((g) => [g.userId, g.tabs]));
      expect(byId.get(GUEST_ID)?.quota).toBe(true);
      expect(byId.get(OTHER_GUEST_ID)).toEqual(DEFAULT_SURVEY_GUEST_TABS);
    });

    it('탭을 아무리 열어도 capability 는 늘지 않는다 — 분석·export 는 항상 차단', async () => {
      const owner = clientFor(OWNER_ID);
      await owner.guests.add({ surveyId, userId: GUEST_ID });
      await owner.guests.setTabs({
        surveyId,
        userId: GUEST_ID,
        tabs: { overview: true, progressReport: true, contactsMasked: true, quota: true },
      });

      const { capabilities } = await guestAccess();
      expect([...capabilities].sort()).toEqual(['operations.view', 'survey.view']);
    });

    it('없는 부여에 탭을 저장하면 NOT_FOUND — 조용히 성공하지 않는다', async () => {
      await expect(
        clientFor(OWNER_ID).guests.setTabs({
          surveyId,
          userId: GUEST_ID,
          tabs: DEFAULT_SURVEY_GUEST_TABS,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 대상 자격
  // ───────────────────────────────────────────────────────────────────────────

  describe('부여 대상은 활성 게스트 계정뿐이다', () => {
    it.each([
      ['내부 계정', () => MEMBER_ID],
      ['실사 계정', () => FIELDWORK_ID],
      ['정지된 게스트', () => SUSPENDED_GUEST_ID],
    ])('%s 는 BAD_REQUEST 로 막힌다', async (_label, pick) => {
      await expect(
        clientFor(OWNER_ID).guests.add({ surveyId, userId: pick() }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('후보 검색에도 활성 게스트만 뜬다', async () => {
      const found = await clientFor(OWNER_ID).guests.searchCandidates({ surveyId, query: '' });
      const ids = found.map((c) => c.userId);
      expect(ids).toContain(GUEST_ID);
      expect(ids).toContain(OTHER_GUEST_ID);
      expect(ids).not.toContain(MEMBER_ID);
      expect(ids).not.toContain(FIELDWORK_ID);
      expect(ids).not.toContain(SUSPENDED_GUEST_ID);
    });

    it('이미 부여된 계정은 후보에서 빠지고 재추가는 CONFLICT 다', async () => {
      const owner = clientFor(OWNER_ID);
      await owner.guests.add({ surveyId, userId: GUEST_ID });

      const found = await owner.guests.searchCandidates({ surveyId, query: '' });
      expect(found.map((c) => c.userId)).not.toContain(GUEST_ID);
      await expect(owner.guests.add({ surveyId, userId: GUEST_ID })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('목록은 소속 기관을 함께 준다 — 게스트에게는 팀이 없다', async () => {
      await clientFor(OWNER_ID).guests.add({ surveyId, userId: GUEST_ID });
      const list = await clientFor(OWNER_ID).guests.list({ surveyId });
      expect(list.guests[0]?.organization).toBe('한국물류협회');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 추가와 해제의 권한 축이 다르다
  // ───────────────────────────────────────────────────────────────────────────

  describe('추가는 접근자 누구나, 해제는 소유자·팀장·슈퍼어드민', () => {
    it('팀 공개 설문의 팀원도 부여할 수 있다', async () => {
      await clientFor(MEMBER_ID).guests.add({ surveyId, userId: GUEST_ID });
      expect([...(await guestAccess()).capabilities]).toContain('survey.view');
    });

    it('팀원은 해제도 탭 변경도 못 한다 — 목록의 canManage 도 false 다', async () => {
      await clientFor(OWNER_ID).guests.add({ surveyId, userId: GUEST_ID });

      const asMember = await clientFor(MEMBER_ID).guests.list({ surveyId });
      expect(asMember.canManage).toBe(false);
      await expect(
        clientFor(MEMBER_ID).guests.remove({ surveyId, userId: GUEST_ID }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      // 탭 넓히기는 「초대의 범위 변경」이라 같은 축이다(스펙 §11-5) — 이것이 열려 있으면
      // 팀원이 외부인에게 조사 대상(마스킹)·쿼터를 켜 줄 수 있다.
      await expect(
        clientFor(MEMBER_ID).guests.setTabs({
          surveyId,
          userId: GUEST_ID,
          tabs: { overview: true, progressReport: true, contactsMasked: true, quota: true },
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('소유자·팀장·슈퍼어드민은 해제할 수 있다', async () => {
      for (const [userId, isSuperadmin] of [
        [OWNER_ID, false],
        [LEADER_ID, false],
        [SUPERADMIN_ID, true],
      ] as const) {
        await clientFor(OWNER_ID).guests.add({ surveyId, userId: GUEST_ID });
        const actor = clientFor(userId, isSuperadmin);
        expect((await actor.guests.list({ surveyId })).canManage).toBe(true);
        await expect(
          actor.guests.remove({ surveyId, userId: GUEST_ID }),
        ).resolves.toEqual({ success: true });
      }
    });

    it('접근할 수 없는 사람은 목록조차 볼 수 없다 — 존재 은닉(NOT_FOUND)', async () => {
      // 후보 목록은 발급된 클라이언트 계정 명부라, 관문이 없으면 설문 id 하나로 전 고객사
      // 계정을 훑을 수 있다.
      await expect(clientFor(UNASSIGNED_ID).guests.list({ surveyId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        clientFor(UNASSIGNED_ID).guests.searchCandidates({ surveyId, query: '' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
