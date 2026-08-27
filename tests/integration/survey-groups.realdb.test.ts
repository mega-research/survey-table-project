/**
 * 설문 그룹 왕복 (역할 모델 v2 티켓 12) — 실 로컬 DB.
 *
 * 관문을 모킹하지 않는다. 실제 user·team·membership·survey 를 심어 capability 엔진과 FK
 * 동작(그룹 삭제 → 미분류)까지 관통 검증한다. 여기서만 확인할 수 있는 것 셋:
 *
 * ① 그룹 삭제가 설문을 지우지 않고 미분류로 되돌린다 (ON DELETE SET NULL)
 * ② 팀 안에서 그룹 이름이 유일하고 다른 팀은 같은 이름을 쓸 수 있다 (부분 UNIQUE)
 * ③ 담기·이동이 팀 경계를 잠긴 값으로 재검증한다 (FOR UPDATE)
 */
import { createRouterClient, ORPCError } from '@orpc/server';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveyGroups as surveyGroupsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import { surveyGroups } from '@/server/workspace/procedures/survey-groups';
import * as svc from '@/server/workspace/services/survey-groups';
import { TeamNotFoundError } from '@/server/workspace/domain/teams';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const MEMBER_ID = crypto.randomUUID();
const OUTSIDER_ID = crypto.randomUUID();
const TEAM_A = crypto.randomUUID();
const TEAM_B = crypto.randomUUID();

function contextFor(userId: string): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `survey-groups-${userId}@example.com`,
      name: '그룹테스터',
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
    },
  };
}

const createdSurveyIds: string[] = [];
/** 해산 케이스가 심는 팀 — 고정 팀 둘(TEAM_A·B)을 archived 로 만들면 다른 케이스가 깨진다. */
const createdTeamIds: string[] = [];
const createdGroupIds: string[] = [];
/** 케이스가 추가로 심은 사용자 — 설문이 소유자로 참조하므로 설문을 지운 뒤에 정리한다. */
const createdUserIds: string[] = [];

async function seedUser(id: string): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `survey-groups-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin: false,
    userType: 'internal',
  });
}

/** 팀 A 소속 설문을 하나 심는다. 그룹은 미분류로 시작한다. */
async function seedSurvey(teamId: string, title: string, ownerUserId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id,
    title,
    teamId,
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId,
    createdBy: ownerUserId,
  });
  createdSurveyIds.push(id);
  return id;
}

async function seedGroup(client: ReturnType<typeof clientFor>, teamId: string, name: string) {
  const { id } = await client.surveyGroups.create({ teamId, name });
  createdGroupIds.push(id);
  return id;
}

function clientFor(userId: string) {
  return createRouterClient({ surveyGroups }, { context: contextFor(userId) });
}

describe.skipIf(!isLocalDb)('설문 그룹 왕복 (real local DB)', () => {
  const member = clientFor(MEMBER_ID);
  const outsider = clientFor(OUTSIDER_ID);

  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(MEMBER_ID);
    await seedUser(OUTSIDER_ID);
    await db.insert(teamsTable).values([
      { id: TEAM_A, name: `그룹팀A-${TEAM_A.slice(0, 8)}` },
      { id: TEAM_B, name: `그룹팀B-${TEAM_B.slice(0, 8)}` },
    ]);
    // MEMBER 는 팀 A 의 **팀원**(팀장 아님) — 그룹 구조는 팀 공용이라 이걸로 충분해야 한다.
    await db.insert(teamMembersTable).values({ teamId: TEAM_A, userId: MEMBER_ID, role: 'member' });
    // OUTSIDER 는 팀 B 소속이라 팀 A 의 그룹을 볼 수도 만질 수도 없어야 한다.
    await db
      .insert(teamMembersTable)
      .values({ teamId: TEAM_B, userId: OUTSIDER_ID, role: 'leader' });
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    // 각 케이스가 자기 그룹·설문을 새로 심는다 — 이전 케이스가 남긴 상태를 지운다.
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
      createdSurveyIds.length = 0;
    }
    if (createdGroupIds.length > 0) {
      await db.delete(surveyGroupsTable).where(inArray(surveyGroupsTable.id, createdGroupIds));
      createdGroupIds.length = 0;
    }
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
    }
    if (createdGroupIds.length > 0) {
      await db.delete(surveyGroupsTable).where(inArray(surveyGroupsTable.id, createdGroupIds));
    }
    if (createdTeamIds.length > 0) {
      await db.delete(surveyGroupsTable).where(inArray(surveyGroupsTable.teamId, createdTeamIds));
    }
    await db
      .delete(teamMembersTable)
      .where(inArray(teamMembersTable.userId, [MEMBER_ID, OUTSIDER_ID]));
    await db
      .delete(teamsTable)
      .where(inArray(teamsTable.id, [TEAM_A, TEAM_B, ...createdTeamIds]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [MEMBER_ID, OUTSIDER_ID, ...createdUserIds]));
  });

  it('팀원이 그룹을 만들고 미분류 설문을 담고 케밥으로 옮기는 전 과정', async () => {
    const groupId = await seedGroup(member, TEAM_A, '2025');
    const other = await seedGroup(member, TEAM_A, '2026 상반기');
    const s1 = await seedSurvey(TEAM_A, '고객 만족도 조사', MEMBER_ID);
    const s2 = await seedSurvey(TEAM_A, '신제품 컨셉 테스트', MEMBER_ID);

    // 담기 후보는 미분류 설문 둘 — 팀원이라 둘 다 옮길 수 있다.
    const candidates = await member.surveyGroups.listUngrouped({ teamId: TEAM_A, query: '' });
    expect(candidates.map((c) => c.id).sort()).toEqual([s1, s2].sort());
    expect(candidates.every((c) => c.canMove)).toBe(true);

    await member.surveyGroups.collect({ groupId, surveyIds: [s1, s2] });

    // 담긴 뒤에는 후보에서 사라지고 그룹 카운트가 오른다.
    expect(await member.surveyGroups.listUngrouped({ teamId: TEAM_A, query: '' })).toEqual([]);
    const listed = await member.surveyGroups.list({ teamId: TEAM_A });
    expect(listed.find((g) => g.id === groupId)?.surveyCount).toBe(2);

    // 케밥 단건 이동 — 다른 그룹으로.
    await member.surveyGroups.move({ surveyId: s1, groupId: other });
    expect((await member.surveyGroups.list({ teamId: TEAM_A })).map((g) => g.surveyCount)).toEqual([
      1, 1,
    ]);

    // 미분류로 빼기.
    await member.surveyGroups.move({ surveyId: s1, groupId: null });
    expect(
      (await member.surveyGroups.listUngrouped({ teamId: TEAM_A, query: '' })).map((c) => c.id),
    ).toEqual([s1]);
  });

  it('그룹 삭제는 설문을 지우지 않고 미분류로 되돌린다', async () => {
    const groupId = await seedGroup(member, TEAM_A, '삭제될 그룹');
    const surveyId = await seedSurvey(TEAM_A, '삭제 대상 아님', MEMBER_ID);
    await member.surveyGroups.collect({ groupId, surveyIds: [surveyId] });

    await member.surveyGroups.remove({ groupId });

    const [row] = await db
      .select({ id: surveysTable.id, surveyGroupId: surveysTable.surveyGroupId })
      .from(surveysTable)
      .where(eq(surveysTable.id, surveyId));
    expect(row).toBeDefined();
    expect(row?.surveyGroupId).toBeNull();
  });

  it('그룹 이름은 팀 안에서만 유일하다', async () => {
    await seedGroup(member, TEAM_A, '중복이름');

    await expect(
      member.surveyGroups.create({ teamId: TEAM_A, name: '중복이름' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // 다른 팀은 같은 이름을 쓸 수 있다.
    const { id } = await outsider.surveyGroups.create({ teamId: TEAM_B, name: '중복이름' });
    createdGroupIds.push(id);
    expect(id).toBeTruthy();
  });

  it('타 팀 사람은 그룹을 보지도 만지지도 못한다', async () => {
    const groupId = await seedGroup(member, TEAM_A, '팀A 전용');

    await expect(outsider.surveyGroups.list({ teamId: TEAM_A })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // 그룹 id 를 알아도 존재를 확인할 수 없다 — 사유는 NOT_FOUND 로 접힌다.
    await expect(
      outsider.surveyGroups.rename({ groupId, name: '가로채기' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(outsider.surveyGroups.remove({ groupId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('타 팀 설문은 담을 수도 옮길 수도 없다', async () => {
    const groupA = await seedGroup(member, TEAM_A, '팀A 그룹');
    const groupB = await seedGroup(outsider, TEAM_B, '팀B 그룹');
    const surveyB = await seedSurvey(TEAM_B, '팀B 설문', OUTSIDER_ID);

    // 관문이 먼저 막는다 — 볼 수 없는 설문이라 NOT_FOUND(존재 은닉).
    await expect(
      member.surveyGroups.collect({ groupId: groupA, surveyIds: [surveyB] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      member.surveyGroups.move({ surveyId: surveyB, groupId: groupB }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('이미 다른 그룹에 있는 설문은 담기로 빼올 수 없다', async () => {
    const first = await seedGroup(member, TEAM_A, '첫 그룹');
    const second = await seedGroup(member, TEAM_A, '두 번째 그룹');
    const surveyId = await seedSurvey(TEAM_A, '이미 담긴 설문', MEMBER_ID);
    await member.surveyGroups.collect({ groupId: first, surveyIds: [surveyId] });

    await expect(
      member.surveyGroups.collect({ groupId: second, surveyIds: [surveyId] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('배치 대기 설문은 그룹에 담기지 않는다', async () => {
    const groupId = await seedGroup(member, TEAM_A, '배치 대기 시험');
    const pendingId = crypto.randomUUID();
    await db.insert(surveysTable).values({
      id: pendingId,
      title: '배치 대기 설문',
      teamId: null,
      assignmentStatus: 'assignment_pending',
      ownerUserId: MEMBER_ID,
      createdBy: MEMBER_ID,
    });
    createdSurveyIds.push(pendingId);

    await expect(
      member.surveyGroups.collect({ groupId, surveyIds: [pendingId] }),
    ).rejects.toBeInstanceOf(ORPCError);
    expect(
      (await member.surveyGroups.listUngrouped({ teamId: TEAM_A, query: '' })).map((c) => c.id),
    ).not.toContain(pendingId);
  });

  it('팀원에게 숨긴 invite_only 설문은 담기 후보에 제목조차 나오지 않는다', async () => {
    const mine = await seedSurvey(TEAM_A, '내가 만든 초대 전용', MEMBER_ID);
    await db
      .update(surveysTable)
      .set({ visibility: 'invite_only' })
      .where(eq(surveysTable.id, mine));

    // 같은 팀의 다른 사람이 소유한 invite_only — 팀원에게는 존재 자체가 숨겨진다(스펙 §3).
    const leaderId = crypto.randomUUID();
    await seedUser(leaderId);
    createdUserIds.push(leaderId);
    const hidden = await seedSurvey(TEAM_A, '남의 초대 전용 설문', leaderId);
    await db
      .update(surveysTable)
      .set({ visibility: 'invite_only' })
      .where(eq(surveysTable.id, hidden));

    const candidates = await member.surveyGroups.listUngrouped({ teamId: TEAM_A, query: '' });

    // 소유자인 나는 내 것을 본다. 남의 invite_only 는 목록에서 아예 빠진다.
    expect(candidates.map((c) => c.id)).toEqual([mine]);
  });

  it('그룹 카운트도 팀원에게 숨긴 invite_only 를 세지 않는다', async () => {
    const groupId = await seedGroup(member, TEAM_A, '카운트 시험');
    const visible = await seedSurvey(TEAM_A, '팀 공개 설문', MEMBER_ID);
    await member.surveyGroups.collect({ groupId, surveyIds: [visible] });

    const leaderId = crypto.randomUUID();
    await seedUser(leaderId);
    createdUserIds.push(leaderId);
    const hidden = await seedSurvey(TEAM_A, '숨은 설문', leaderId);
    await db
      .update(surveysTable)
      .set({ visibility: 'invite_only', surveyGroupId: groupId })
      .where(eq(surveysTable.id, hidden));

    // 팀원에게는 1건 — 사이드바 숫자와 그룹 화면 카드 수가 같아야 한다.
    const asMember = await member.surveyGroups.list({ teamId: TEAM_A });
    expect(asMember.find((g) => g.id === groupId)?.surveyCount).toBe(1);
  });

  it('담기 후보 검색은 제목 부분 일치로 좁힌다', async () => {
    await seedSurvey(TEAM_A, '2026 브랜드 인지도 조사', MEMBER_ID);
    const target = await seedSurvey(TEAM_A, '고객 만족도 조사', MEMBER_ID);

    const found = await member.surveyGroups.listUngrouped({ teamId: TEAM_A, query: '만족도' });

    expect(found.map((c) => c.id)).toEqual([target]);
  });

  it('정렬은 화면이 준 순서를 0..n-1 로 다시 매긴다', async () => {
    const first = await seedGroup(member, TEAM_A, '가');
    const second = await seedGroup(member, TEAM_A, '나');
    const third = await seedGroup(member, TEAM_A, '다');

    await member.surveyGroups.reorder({
      teamId: TEAM_A,
      orderedGroupIds: [third, first, second],
    });

    expect((await member.surveyGroups.list({ teamId: TEAM_A })).map((g) => g.id)).toEqual([
      third,
      first,
      second,
    ]);
  });

  /**
   * 관문(procedure)이 아니라 **서비스가** 해산을 막는가 (Codex 2차 리뷰).
   *
   * 관문의 active 팀 확인은 별도 왕복이라, 확인과 쓰기 사이에 해산이 커밋되면 archived 팀의
   * 그룹 행이 그대로 수정·삭제된다. 티켓 13 이 그 행을 감사 계보로 남기기로 한 이상 그 창을
   * 닫아야 한다. 관문을 **건너뛰고 서비스를 직접** 불러 그 재검증만 본다 — 관문을 태우면
   * 관문이 먼저 막아 서비스 쪽 구멍이 그대로 있어도 초록이다.
   */
  describe('해산된 팀의 그룹은 서비스 단계에서도 막힌다', () => {
    async function seedArchivedTeamGroup() {
      const teamId = crypto.randomUUID();
      await db
        .insert(teamsTable)
        .values({ id: teamId, name: `해산예정팀-${teamId.slice(0, 8)}` });
      createdTeamIds.push(teamId);
      await db.insert(teamMembersTable).values({ teamId, userId: MEMBER_ID, role: 'leader' });
      const groupId = await seedGroup(clientFor(MEMBER_ID), teamId, '해산 전 그룹');
      // 해산을 흉내낸다 — 티켓 13 의 dissolveTeam 이 하는 것과 같은 상태.
      await db
        .update(teamsTable)
        .set({ status: 'archived', archivedAt: new Date() })
        .where(eq(teamsTable.id, teamId));
      return { teamId, groupId };
    }

    it('삭제 — 감사 계보로 남겨야 할 행이 사라지지 않는다', async () => {
      const { groupId } = await seedArchivedTeamGroup();

      await expect(svc.removeSurveyGroup(groupId)).rejects.toBeInstanceOf(TeamNotFoundError);

      const [row] = await db
        .select({ id: surveyGroupsTable.id })
        .from(surveyGroupsTable)
        .where(eq(surveyGroupsTable.id, groupId));
      expect(row).toBeDefined();
    });

    it('이름 변경 — 해산 시점 이름이 보존된다', async () => {
      const { groupId } = await seedArchivedTeamGroup();

      await expect(
        svc.renameSurveyGroup({ groupId, name: '되살리기' }),
      ).rejects.toBeInstanceOf(TeamNotFoundError);

      const [row] = await db
        .select({ name: surveyGroupsTable.name })
        .from(surveyGroupsTable)
        .where(eq(surveyGroupsTable.id, groupId));
      expect(row?.name).toBe('해산 전 그룹');
    });

    it('생성 — 죽은 팀에 새 폴더가 붙지 않는다', async () => {
      const { teamId } = await seedArchivedTeamGroup();

      await expect(
        svc.createSurveyGroup(MEMBER_ID, { teamId, name: '사후 그룹' }),
      ).rejects.toBeInstanceOf(TeamNotFoundError);
    });

    it('정렬 — 죽은 팀의 순서도 고칠 수 없다', async () => {
      const { teamId, groupId } = await seedArchivedTeamGroup();

      await expect(
        svc.reorderSurveyGroups({ teamId, orderedGroupIds: [groupId] }),
      ).rejects.toBeInstanceOf(TeamNotFoundError);
    });
  });

  it('타 팀 그룹 id 가 정렬 배열에 섞여도 그 행에는 닿지 않는다', async () => {
    const mine = await seedGroup(member, TEAM_A, '내 그룹');
    const theirs = await seedGroup(outsider, TEAM_B, '남의 그룹');
    await outsider.surveyGroups.reorder({ teamId: TEAM_B, orderedGroupIds: [theirs] });

    await member.surveyGroups.reorder({ teamId: TEAM_A, orderedGroupIds: [theirs, mine] });

    // 남의 그룹은 order 가 그대로여야 한다(위 reorder 로 0).
    const [row] = await db
      .select({ order: surveyGroupsTable.order })
      .from(surveyGroupsTable)
      .where(eq(surveyGroupsTable.id, theirs));
    expect(row?.order).toBe(0);
  });
});
