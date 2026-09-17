/**
 * 공유 설정 왕복 (역할 모델 v2 티켓 16) — 실 로컬 DB.
 *
 * 관문도 SQL 도 모킹하지 않는다. 목으로는 증명할 수 없는 셋만 여기서 본다.
 *
 * ① **전환이 실제로 팀원의 목록에서 설문을 지운다.** 목록은 SQL 조건이라(getScopedSurveys
 *    의 seesInviteOnly) 목이 무엇을 돌려주든 통과한다 — 조건을 지워도 초록인 자리다.
 * ② **`updatedAt` 이 움직이지 않는다.** 공개 범위는 설문 내용이 아니다. 건드리면 「최신
 *    수정순」 기본 정렬이 공유 설정 한 번에 통째로 뒤집힌다(그룹 이동과 같은 계약).
 * ③ **삭제된 설문은 NOT_FOUND 로 나간다.** 실제로 막는 것은 관문(loadSurveyCapabilities 가
 *    `deleted_at IS NULL` 로 조회한다)이고, 서비스 WHERE 의 같은 조건은 관문과 UPDATE 사이
 *    창에서만 일하는 두 번째 겹이라 밖에서는 갈라 볼 수 없다 — 여기서 고정하는 것은 표면
 *    동작이다.
 *
 * 권한 축(팀원은 못 바꾼다·타 팀은 NOT_FOUND)은 procedure 관문이 지므로 여기서도 한 번
 * 관통 확인한다 — 관문이 붙어 있다는 것과 엔진이 실제로 거부한다는 것은 다른 사실이다.
 */
import { createRouterClient } from '@orpc/server';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import { getScopedSurveys } from '@/server/read-models/survey-structure';
import { loadAccessSubject } from '@/server/survey-access';
import { buildSurveyScopeFilter } from '@/server/work-scope';
import { sharing } from '@/server/workspace/procedures/sharing';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const OWNER_ID = crypto.randomUUID();
const LEADER_ID = crypto.randomUUID();
const MEMBER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();

function contextFor(userId: string): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `sharing-${userId}@example.com`,
      name: '공유테스터',
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
    },
  };
}

function clientFor(userId: string) {
  return createRouterClient({ sharing }, { context: contextFor(userId) });
}

const createdSurveyIds: string[] = [];

async function seedUser(id: string): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `sharing-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin: false,
    userType: 'internal',
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
  createdSurveyIds.push(id);
  return id;
}

/** 그 사람이 팀 범위에서 보는 설문 id — 목록 SQL 을 그대로 지난다. */
async function visibleIds(userId: string): Promise<string[]> {
  const subject = await loadAccessSubject({
    id: userId,
    isSuperadmin: false,
    userType: 'internal',
  });
  const rows = await getScopedSurveys(
    buildSurveyScopeFilter(subject, { kind: 'team', teamId: TEAM_ID }),
  );
  return rows.map((row) => row.id);
}

describe.skipIf(!isLocalDb)('공유 설정 — 공개 범위 (real local DB)', () => {
  const owner = clientFor(OWNER_ID);
  const leader = clientFor(LEADER_ID);
  const member = clientFor(MEMBER_ID);

  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(OWNER_ID);
    await seedUser(LEADER_ID);
    await seedUser(MEMBER_ID);
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `공유팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_ID, userId: OWNER_ID, role: 'member' },
      { teamId: TEAM_ID, userId: LEADER_ID, role: 'leader' },
      { teamId: TEAM_ID, userId: MEMBER_ID, role: 'member' },
    ]);
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
      createdSurveyIds.length = 0;
    }
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
    }
    await db
      .delete(teamMembersTable)
      .where(inArray(teamMembersTable.userId, [OWNER_ID, LEADER_ID, MEMBER_ID]));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(inArray(usersTable.id, [OWNER_ID, LEADER_ID, MEMBER_ID]));
  });

  it('소유자가 전환하면 팀원의 목록에서 사라지고 되돌리면 돌아온다', async () => {
    const surveyId = await seedSurvey('고객 만족도 조사');
    expect(await visibleIds(MEMBER_ID)).toContain(surveyId);

    await owner.sharing.setVisibility({ surveyId, visibility: 'invite_only' });
    expect(await visibleIds(MEMBER_ID)).not.toContain(surveyId);
    // 팀원에게만 숨긴다 — 소유자와 팀장은 그대로 본다(스펙 §3).
    expect(await visibleIds(OWNER_ID)).toContain(surveyId);
    expect(await visibleIds(LEADER_ID)).toContain(surveyId);

    await owner.sharing.setVisibility({ surveyId, visibility: 'team' });
    expect(await visibleIds(MEMBER_ID)).toContain(surveyId);
  });

  it('팀장도 바꿀 수 있다 — invite_only 여도 팀장은 전권이다', async () => {
    const surveyId = await seedSurvey('임원 조사');
    await leader.sharing.setVisibility({ surveyId, visibility: 'invite_only' });
    await leader.sharing.setVisibility({ surveyId, visibility: 'team' });

    const [row] = await db
      .select({ visibility: surveysTable.visibility })
      .from(surveysTable)
      .where(eq(surveysTable.id, surveyId));
    expect(row?.visibility).toBe('team');
  });

  it('팀원은 FORBIDDEN — 편집권은 있어도 공개 범위는 못 바꾼다', async () => {
    const surveyId = await seedSurvey('신제품 컨셉 테스트');

    await expect(
      member.sharing.setVisibility({ surveyId, visibility: 'invite_only' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const [row] = await db
      .select({ visibility: surveysTable.visibility })
      .from(surveysTable)
      .where(eq(surveysTable.id, surveyId));
    expect(row?.visibility).toBe('team');
  });

  it('숨긴 설문은 팀원에게 존재조차 알리지 않는다 — NOT_FOUND', async () => {
    const surveyId = await seedSurvey('숨긴 조사');
    await owner.sharing.setVisibility({ surveyId, visibility: 'invite_only' });

    // 같은 팀원이지만 이제 survey.view 조차 없다 — FORBIDDEN 이면 id 스캔으로 존재가 샌다.
    await expect(
      member.sharing.setVisibility({ surveyId, visibility: 'team' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('updatedAt 을 건드리지 않는다 — 「최신 수정순」 정렬이 공유 한 번에 뒤집히지 않게', async () => {
    const surveyId = await seedSurvey('정렬 보존 조사');
    const [before] = await db
      .select({ updatedAt: surveysTable.updatedAt })
      .from(surveysTable)
      .where(eq(surveysTable.id, surveyId));

    await owner.sharing.setVisibility({ surveyId, visibility: 'invite_only' });

    const [after] = await db
      .select({ updatedAt: surveysTable.updatedAt })
      .from(surveysTable)
      .where(eq(surveysTable.id, surveyId));
    expect(after?.updatedAt?.getTime()).toBe(before?.updatedAt?.getTime());
  });

  it('삭제된 설문은 NOT_FOUND — tombstone 이 조용히 수정되지 않는다', async () => {
    const surveyId = await seedSurvey('삭제된 조사');
    await db
      .update(surveysTable)
      .set({ deletedAt: new Date() })
      .where(eq(surveysTable.id, surveyId));

    await expect(
      owner.sharing.setVisibility({ surveyId, visibility: 'invite_only' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const [row] = await db
      .select({ visibility: surveysTable.visibility })
      .from(surveysTable)
      .where(eq(surveysTable.id, surveyId));
    expect(row?.visibility).toBe('team');
  });
});
