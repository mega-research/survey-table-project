/**
 * 사용자 목록의 소속 팀 이름 (`teamNames`) — 실 로컬 DB.
 *
 * 실 DB 인 이유는 값이 상관 서브쿼리 한 줄에서 나오기 때문이다. 목은 그 SQL 을 돌리지 않아
 * 겸직 순서·해산 팀 제외·한 사람 한 행이 전부 증명되지 않는다.
 */
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { listUsers } from '@/server/auth/services/users';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const RUN = crypto.randomUUID().slice(0, 8);
const MEMBER_ID = crypto.randomUUID();
const HEAD_ID = crypto.randomUUID();
const UNASSIGNED_ID = crypto.randomUUID();
const USER_IDS = [MEMBER_ID, HEAD_ID, UNASSIGNED_ID];

const TEAM_A = crypto.randomUUID();
const TEAM_B = crypto.randomUUID();
const TEAM_ARCHIVED = crypto.randomUUID();
const TEAM_IDS = [TEAM_A, TEAM_B, TEAM_ARCHIVED];

async function cleanup(): Promise<void> {
  await db.delete(teamMembersTable).where(inArray(teamMembersTable.teamId, TEAM_IDS));
  await db.delete(teamsTable).where(inArray(teamsTable.id, TEAM_IDS));
  await db.delete(usersTable).where(inArray(usersTable.id, USER_IDS));
}

describe.skipIf(!isLocalDb)('listUsers — 소속 팀 이름 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values(
      USER_IDS.map((id, i) => ({
        id,
        name: `팀표시-${i}-${RUN}`,
        email: `users-list-teams-${id}@example.com`,
        emailVerified: true,
        status: 'active' as const,
        isSuperadmin: false,
        userType: 'internal' as const,
      })),
    );
    // 순서 값을 이름과 거꾸로 둔다 — 이름순이 아니라 팀 순서대로 나오는지 보려고.
    await db.insert(teamsTable).values([
      { id: TEAM_A, name: `나팀-${RUN}`, order: 1 },
      { id: TEAM_B, name: `가팀-${RUN}`, order: 2 },
      {
        id: TEAM_ARCHIVED,
        name: `해산팀-${RUN}`,
        order: 0,
        status: 'archived',
        archivedBy: HEAD_ID,
        archivedAt: new Date(),
      },
    ]);
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_A, userId: MEMBER_ID },
      { teamId: TEAM_A, userId: HEAD_ID, role: 'leader' },
      { teamId: TEAM_B, userId: HEAD_ID, role: 'leader' },
      { teamId: TEAM_ARCHIVED, userId: HEAD_ID },
    ]);
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    await cleanup();
  });

  async function teamNamesOf(userId: string): Promise<string[][]> {
    const { items } = await listUsers({ userType: 'all', status: 'all' });
    return items.filter((item) => item.id === userId).map((item) => item.teamNames);
  }

  it('팀원은 소속 팀 하나다', async () => {
    expect(await teamNamesOf(MEMBER_ID)).toEqual([[`나팀-${RUN}`]]);
  });

  it('겸직은 한 행에 팀 순서대로 모이고, 해산한 팀은 빠진다', async () => {
    expect(await teamNamesOf(HEAD_ID)).toEqual([[`나팀-${RUN}`, `가팀-${RUN}`]]);
  });

  it('미배치는 빈 배열이다 — null 이 아니다', async () => {
    expect(await teamNamesOf(UNASSIGNED_ID)).toEqual([[]]);
  });
});
