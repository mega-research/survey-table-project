/**
 * 설문 종료 왕복 (ADR-0030, 티켓 01) — 실 로컬 DB.
 *
 * 관문도 SQL 도 모킹하지 않는다. 목으로는 증명할 수 없는 것만 여기서 본다.
 *
 * ① **전이가 둘뿐이다.** 종료·종료 취소는 조건부 UPDATE 한 번이라, 그 WHERE 가 무엇을
 *    허용하는지는 실제 행으로만 보인다. 특히 **초안에 종료 취소를 보내면 발행 상태가 되는**
 *    사고는 조건을 빠뜨려도 목 위에서는 초록이다 — 발행은 스냅샷을 만드는 일이라, status 만
 *    published 인 초안은 응답 화면이 열 스냅샷이 없는 채로 「배포됨」이 된다.
 * ② **종료가 다른 축을 건드리지 않는다.** 중단·중단 문구·현재 버전은 종료와 독립이다.
 *    중단해 둔 설문을 종료했다 취소하면 중단 상태로 돌아와야 한다.
 * ③ **삭제된 설문은 NOT_FOUND 로 나간다.** 막는 것은 관문이고, 서비스 WHERE 의 같은 조건은
 *    관문과 UPDATE 사이 창에서만 일한다.
 *
 * 권한 축은 한 번 관통 확인한다 — 중단을 누를 수 있는 사람이면 종료도 누를 수 있어야 한다.
 */
import { createRouterClient } from '@orpc/server';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveys as surveysTable,
  surveyVersions as surveyVersionsTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import { control } from '@/server/operations/procedures/control';
import { loadSurveyCapabilities } from '@/server/survey-access';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const OWNER_ID = crypto.randomUUID();
const MEMBER_ID = crypto.randomUUID();
const OUTSIDER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();
const OTHER_TEAM_ID = crypto.randomUUID();

function clientFor(userId: string) {
  const context: ORPCContext = {
    db,
    user: {
      id: userId,
      email: `close-${userId}@example.com`,
      name: '종료테스터',
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
    },
  };
  return createRouterClient({ control }, { context });
}

const createdSurveyIds: string[] = [];

async function seedUser(id: string): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `close-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin: false,
    userType: 'internal',
  });
}

/** 발행된 설문 — 버전 행을 함께 세워 「발행이 남긴 모양」 그대로 둔다. */
async function seedSurvey(over: Partial<typeof surveysTable.$inferInsert> = {}): Promise<string> {
  const id = crypto.randomUUID();
  const published = (over.status ?? 'published') !== 'draft';
  await db.insert(surveysTable).values({
    id,
    title: '종료 테스트 설문',
    status: 'published',
    teamId: TEAM_ID,
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: OWNER_ID,
    createdBy: OWNER_ID,
    ...over,
  });
  createdSurveyIds.push(id);
  if (published) {
    const versionId = crypto.randomUUID();
    await db.insert(surveyVersionsTable).values({
      id: versionId,
      surveyId: id,
      versionNumber: 1,
      status: 'published',
      snapshot: { questions: [] } as never,
    });
    await db.update(surveysTable).set({ currentVersionId: versionId }).where(eq(surveysTable.id, id));
  }
  return id;
}

async function rowOf(surveyId: string) {
  const [row] = await db
    .select({
      status: surveysTable.status,
      isPaused: surveysTable.isPaused,
      pausedMessage: surveysTable.pausedMessage,
      currentVersionId: surveysTable.currentVersionId,
    })
    .from(surveysTable)
    .where(eq(surveysTable.id, surveyId));
  if (!row) throw new Error('설문 행이 없다');
  return row;
}

describe.skipIf(!isLocalDb)('설문 종료 — 실 DB', () => {
  beforeAll(async () => {
    await db.insert(teamsTable).values([
      { id: TEAM_ID, name: `종료팀-${TEAM_ID.slice(0, 6)}` },
      { id: OTHER_TEAM_ID, name: `남의팀-${OTHER_TEAM_ID.slice(0, 6)}` },
    ]);
    await seedUser(OWNER_ID);
    await seedUser(MEMBER_ID);
    await seedUser(OUTSIDER_ID);
    await db.insert(teamMembersTable).values([
      { id: crypto.randomUUID(), teamId: TEAM_ID, userId: OWNER_ID, role: 'member' },
      { id: crypto.randomUUID(), teamId: TEAM_ID, userId: MEMBER_ID, role: 'member' },
      { id: crypto.randomUUID(), teamId: OTHER_TEAM_ID, userId: OUTSIDER_ID, role: 'leader' },
    ]);
  });

  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      await db.update(surveysTable).set({ currentVersionId: null }).where(inArray(surveysTable.id, createdSurveyIds));
      await db.delete(surveyVersionsTable).where(inArray(surveyVersionsTable.surveyId, createdSurveyIds));
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
    }
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.teamId, [TEAM_ID, OTHER_TEAM_ID]));
    await db.delete(usersTable).where(inArray(usersTable.id, [OWNER_ID, MEMBER_ID, OUTSIDER_ID]));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [TEAM_ID, OTHER_TEAM_ID]));
  });

  it('종료하면 closed 가 되고 조회가 종료 여부를 돌려준다', async () => {
    const surveyId = await seedSurvey();
    const client = clientFor(OWNER_ID);

    expect((await client.control.get({ surveyId }))?.isClosed).toBe(false);
    expect(await client.control.setClosed({ surveyId, isClosed: true })).toEqual({ isClosed: true });

    expect((await rowOf(surveyId)).status).toBe('closed');
    expect((await client.control.get({ surveyId }))?.isClosed).toBe(true);
  });

  it('종료 취소는 발행 상태로 되돌린다', async () => {
    const surveyId = await seedSurvey({ status: 'closed' });
    const client = clientFor(OWNER_ID);

    expect(await client.control.setClosed({ surveyId, isClosed: false })).toEqual({ isClosed: false });
    expect((await rowOf(surveyId)).status).toBe('published');
  });

  it('종료와 종료 취소는 중단·중단 문구·현재 버전을 건드리지 않는다', async () => {
    const surveyId = await seedSurvey({ isPaused: true, pausedMessage: '잠시 점검 중입니다' });
    const client = clientFor(OWNER_ID);
    const before = await rowOf(surveyId);

    await client.control.setClosed({ surveyId, isClosed: true });
    expect(await rowOf(surveyId)).toEqual({ ...before, status: 'closed' });

    // 중단해 둔 설문을 종료했다 취소하면 중단 상태로 돌아온다 — 두 축은 독립이다.
    await client.control.setClosed({ surveyId, isClosed: false });
    expect(await rowOf(surveyId)).toEqual(before);
  });

  it('같은 상태로의 요청은 멱등이다', async () => {
    const surveyId = await seedSurvey();
    const client = clientFor(OWNER_ID);

    await client.control.setClosed({ surveyId, isClosed: true });
    expect(await client.control.setClosed({ surveyId, isClosed: true })).toEqual({ isClosed: true });
    await client.control.setClosed({ surveyId, isClosed: false });
    expect(await client.control.setClosed({ surveyId, isClosed: false })).toEqual({ isClosed: false });
    expect((await rowOf(surveyId)).status).toBe('published');
  });

  it('발행된 적 없는 설문은 종료도 종료 취소도 거부된다 — 초안이 발행 상태가 되지 않는다', async () => {
    const surveyId = await seedSurvey({ status: 'draft' });
    const client = clientFor(OWNER_ID);

    await expect(client.control.setClosed({ surveyId, isClosed: true })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(client.control.setClosed({ surveyId, isClosed: false })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await rowOf(surveyId)).status).toBe('draft');
  });

  it('중단을 누를 수 있는 팀원은 종료도 누를 수 있다', async () => {
    const surveyId = await seedSurvey();
    const member = clientFor(MEMBER_ID);

    await expect(member.control.setPaused({ surveyId, isPaused: true })).resolves.toMatchObject({
      isPaused: true,
    });
    await expect(member.control.setClosed({ surveyId, isClosed: true })).resolves.toEqual({
      isClosed: true,
    });
  });

  it('종료는 내부 주체가 할 수 있는 일을 하나도 줄이지 않는다', async () => {
    // 종료가 닫는 것은 응답 접수와 외부 링크다. 조사가 끝난 뒤의 정리(응답 수정·내보내기·
    // 분석·메일)는 그때부터가 본업이라, 내부 열이 한 칸이라도 줄면 그 일이 막힌다.
    const surveyId = await seedSurvey();
    const member = {
      id: MEMBER_ID,
      isSuperadmin: false,
      userType: 'internal',
    } as const;
    const before = [...(await loadSurveyCapabilities(member, surveyId))].sort();
    expect(before.length).toBeGreaterThan(0);

    await clientFor(OWNER_ID).control.setClosed({ surveyId, isClosed: true });

    expect([...(await loadSurveyCapabilities(member, surveyId))].sort()).toEqual(before);
  });

  it('타 팀 사람에게는 없는 설문이다 — 상태가 그대로다', async () => {
    const surveyId = await seedSurvey();

    await expect(
      clientFor(OUTSIDER_ID).control.setClosed({ surveyId, isClosed: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await rowOf(surveyId)).status).toBe('published');
  });

  it('삭제된 설문은 NOT_FOUND 다', async () => {
    const surveyId = await seedSurvey({ deletedAt: new Date() });

    await expect(
      clientFor(OWNER_ID).control.setClosed({ surveyId, isClosed: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await rowOf(surveyId)).status).toBe('published');
  });
});
