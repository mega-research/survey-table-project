/**
 * 사이드바 요약 조회 (설문 즐겨찾기·태그 티켓 02) — 실 로컬 DB.
 *
 * 요약은 목록과 **같은 범위 조건**을 SQL 로 탄다. 목으로는 조건을 지워도 초록이 되므로
 * 여기서 실제 행으로 본다.
 *
 * ① 범위 밖 설문은 요약에 안 나온다 — 다른 팀 설문, 남이 소유한 invite_only, 삭제된 설문.
 * ② 팀 밖이라도 초대받은 설문은 나온다(목록과 같은 OR 축).
 * ③ 목록(`getSurveyListWithCounts`)과 같은 id 집합·같은 그룹 접기를 낸다 — 갈리면 사이드바
 *    숫자와 본문 카드 수가 어긋난다.
 * ④ 응답 수를 싣지 않는다 — 행 모양이 요약 여섯 칸뿐이다.
 * ⑤ 일반 사용자의 system 요청은 거부된다(목록과 같은 판정 코어).
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveyGroups as surveyGroupsTable,
  surveyParticipants as surveyParticipantsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import {
  getSurveyListWithCounts,
  listSurveySummaries,
} from '@/server/survey-builder/services/survey-read';
import { WorkScopeError } from '@/server/work-scope';
import { SYSTEM_SCOPE } from '@/shared/contracts/workspace';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const VIEWER_ID = crypto.randomUUID();
const COLLEAGUE_ID = crypto.randomUUID();
const OUTSIDER_ID = crypto.randomUUID();
const TEAM_A = crypto.randomUUID();
const TEAM_B = crypto.randomUUID();
const GROUP_A = crypto.randomUUID();
const GROUP_B = crypto.randomUUID();

const viewer = { id: VIEWER_ID, isSuperadmin: false, userType: 'internal' as const };

const S = {
  /** A팀 공개 설문, A팀 그룹에 든다. */
  teamGrouped: crypto.randomUUID(),
  /** A팀 공개 설문, 미분류. */
  teamUngrouped: crypto.randomUUID(),
  /** A팀 설문인데 B팀 그룹 id 가 남은 깨진 상태 — 목록처럼 미분류로 접혀야 한다. */
  foreignGroup: crypto.randomUUID(),
  /** A팀 동료가 소유한 invite_only — 팀원(viewer)에게 안 보인다. */
  inviteOnly: crypto.randomUUID(),
  /** A팀 삭제된 설문 — 안 보인다. */
  deleted: crypto.randomUUID(),
  /** B팀 설문 — 범위 밖. */
  otherTeam: crypto.randomUUID(),
  /** B팀 설문이지만 viewer 가 참여자로 초대됨 — 보인다. */
  invited: crypto.randomUUID(),
};

async function seedUser(id: string, name: string): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name,
    email: `summaries-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin: false,
    userType: 'internal',
  });
}

async function seedSurvey(
  id: string,
  values: Partial<typeof surveysTable.$inferInsert> & { teamId: string; ownerUserId: string },
): Promise<void> {
  await db.insert(surveysTable).values({
    id,
    title: `설문-${id.slice(0, 6)}`,
    visibility: 'team',
    assignmentStatus: 'assigned',
    createdBy: values.ownerUserId,
    ...values,
  });
}

describe.skipIf(!isLocalDb)('사이드바 요약 조회 — 작업 범위 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(VIEWER_ID, '요약-팀원');
    await seedUser(COLLEAGUE_ID, '요약-동료');
    await seedUser(OUTSIDER_ID, '요약-타팀');
    await db.insert(teamsTable).values([
      { id: TEAM_A, name: `요약A-${TEAM_A.slice(0, 6)}` },
      { id: TEAM_B, name: `요약B-${TEAM_B.slice(0, 6)}` },
    ]);
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_A, userId: VIEWER_ID, role: 'member' },
      { teamId: TEAM_A, userId: COLLEAGUE_ID, role: 'member' },
      { teamId: TEAM_B, userId: OUTSIDER_ID, role: 'member' },
    ]);
    await db.insert(surveyGroupsTable).values([
      { id: GROUP_A, teamId: TEAM_A, name: '2026', createdBy: COLLEAGUE_ID },
      { id: GROUP_B, teamId: TEAM_B, name: '2026', createdBy: OUTSIDER_ID },
    ]);

    await seedSurvey(S.teamGrouped, {
      teamId: TEAM_A,
      ownerUserId: COLLEAGUE_ID,
      cardTitle: '카드 제목',
      surveyGroupId: GROUP_A,
    });
    await seedSurvey(S.teamUngrouped, { teamId: TEAM_A, ownerUserId: COLLEAGUE_ID });
    await seedSurvey(S.foreignGroup, {
      teamId: TEAM_A,
      ownerUserId: COLLEAGUE_ID,
      surveyGroupId: GROUP_B,
    });
    await seedSurvey(S.inviteOnly, {
      teamId: TEAM_A,
      ownerUserId: COLLEAGUE_ID,
      visibility: 'invite_only',
    });
    await seedSurvey(S.deleted, {
      teamId: TEAM_A,
      ownerUserId: COLLEAGUE_ID,
      deletedAt: new Date(),
    });
    await seedSurvey(S.otherTeam, { teamId: TEAM_B, ownerUserId: OUTSIDER_ID });
    await seedSurvey(S.invited, {
      teamId: TEAM_B,
      ownerUserId: OUTSIDER_ID,
      surveyGroupId: GROUP_B,
    });
    await db.insert(surveyParticipantsTable).values({
      surveyId: S.invited,
      userId: VIEWER_ID,
      kind: 'member',
      addedBy: OUTSIDER_ID,
    });
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    const ids = Object.values(S);
    await db.delete(surveyParticipantsTable).where(inArray(surveyParticipantsTable.surveyId, ids));
    await db.delete(surveysTable).where(inArray(surveysTable.id, ids));
    await db.delete(surveyGroupsTable).where(inArray(surveyGroupsTable.id, [GROUP_A, GROUP_B]));
    await db
      .delete(teamMembersTable)
      .where(inArray(teamMembersTable.userId, [VIEWER_ID, COLLEAGUE_ID, OUTSIDER_ID]));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [TEAM_A, TEAM_B]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [VIEWER_ID, COLLEAGUE_ID, OUTSIDER_ID]));
  });

  it('범위 밖 설문(다른 팀 · 남의 invite_only · 삭제됨)은 요약에 안 나오고, 초대받은 설문은 나온다', async () => {
    const ids = (await listSurveySummaries(viewer, TEAM_A)).map((row) => row.id);

    expect(ids).not.toContain(S.otherTeam);
    expect(ids).not.toContain(S.inviteOnly);
    expect(ids).not.toContain(S.deleted);
    expect(new Set(ids)).toEqual(
      new Set([S.teamGrouped, S.teamUngrouped, S.foreignGroup, S.invited]),
    );
  });

  it('행은 요약 여섯 칸뿐이다 — 응답 수를 싣지 않고, 남의 팀 그룹 id 는 미분류로 접는다', async () => {
    const rows = await listSurveySummaries(viewer, TEAM_A);
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(S.teamGrouped)).toEqual({
      id: S.teamGrouped,
      title: `설문-${S.teamGrouped.slice(0, 6)}`,
      cardTitle: '카드 제목',
      teamId: TEAM_A,
      teamName: `요약A-${TEAM_A.slice(0, 6)}`,
      surveyGroupId: GROUP_A,
    });
    expect(byId.get(S.foreignGroup)?.surveyGroupId).toBeNull();
    // 초대받은 타 팀 설문은 그 팀 그룹에 그대로 선다(설문 팀 = 그룹 팀).
    expect(byId.get(S.invited)).toMatchObject({ teamId: TEAM_B, surveyGroupId: GROUP_B });
  });

  it('목록과 같은 id 집합 · 같은 팀/그룹 값을 낸다', async () => {
    const [summaries, list] = await Promise.all([
      listSurveySummaries(viewer, TEAM_A),
      getSurveyListWithCounts(viewer, TEAM_A),
    ]);
    const project = (rows: { id: string; teamId: string | null; surveyGroupId: string | null }[]) =>
      rows
        .map(({ id, teamId, surveyGroupId }) => ({ id, teamId, surveyGroupId }))
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(project(summaries)).toEqual(project(list.surveys));
  });

  it('내 팀이 아닌 teamId 는 첫 활성 팀으로 접힌다 — B팀을 지목해도 B팀 설문이 새지 않는다', async () => {
    const ids = (await listSurveySummaries(viewer, TEAM_B)).map((row) => row.id);
    expect(ids).not.toContain(S.otherTeam);
    expect(ids).toContain(S.teamUngrouped);
  });

  it('일반 사용자의 system 요청은 거부된다', async () => {
    await expect(listSurveySummaries(viewer, SYSTEM_SCOPE)).rejects.toBeInstanceOf(WorkScopeError);
  });

  it('소속 팀이 없는 사람은 빈 요약이다', async () => {
    const loner = crypto.randomUUID();
    await seedUser(loner, '요약-무소속');
    try {
      await expect(
        listSurveySummaries({ id: loner, isSuperadmin: false, userType: 'internal' }, null),
      ).resolves.toEqual([]);
    } finally {
      await db.delete(usersTable).where(eq(usersTable.id, loner));
    }
  });
});
