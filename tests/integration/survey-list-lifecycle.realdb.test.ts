/**
 * 목록 상태 — SQL 식과 TS 함수가 같은 표에서 같은 답을 내는가 — 실 로컬 DB.
 *
 * 설문 목록은 SQL 로 세고 거르며(서버 페이지네이션), 게스트 홈은 TS 로 판정한다. 두 벌이
 * 갈리면 같은 설문이 화면마다 다른 상태로 보인다. 표는 `tests/fixtures/survey-list-lifecycle-cases`
 * 하나이고 TS 쪽 단위 테스트도 같은 표를 쓴다.
 *
 * 실 DB 인 이유: 비교 연산·NULL 처리·timestamptz 비교는 PostgreSQL 이 정한다. 목으로는 식이
 * 무엇이든 통과한다. 테이블 행은 만들지 않는다 — 식의 입력을 리터럴로 꽂아 판정만 본다.
 */
import {
  LIFECYCLE_NOW,
  SURVEY_LIST_LIFECYCLE_CASES,
} from '@tests/fixtures/survey-list-lifecycle-cases';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveyVersions,
  surveys,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { surveyListLifecycleSql } from '@/server/read-models/survey-list-lifecycle';
import * as surveyReadSvc from '@/server/survey-builder/services/survey-read';
import {
  normalizeSurveyStatus,
  resolveSurveyListLifecycle,
} from '@/shared/contracts/survey-builder-io';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

describe.skipIf(!isLocalDb)('surveyListLifecycleSql — TS 판정과 같은 표', () => {
  it.each(SURVEY_LIST_LIFECYCLE_CASES)('$name → $expected', async (c) => {
    const expr = surveyListLifecycleSql(
      {
        status: sql`${c.status}::text`,
        currentVersionId: sql`${c.currentVersionId}::uuid`,
        endDate: sql`${c.endDate?.toISOString() ?? null}::timestamptz`,
      },
      sql`${LIFECYCLE_NOW.toISOString()}::timestamptz`,
    );
    const rows = await db.execute<{ lifecycle: string }>(sql`select ${expr} as lifecycle`);
    const fromSql = rows[0]?.lifecycle;

    const fromTs = resolveSurveyListLifecycle(
      {
        status: normalizeSurveyStatus(c.status),
        currentVersionId: c.currentVersionId,
        endDate: c.endDate,
      },
      LIFECYCLE_NOW.getTime(),
    );

    expect(fromSql).toBe(c.expected);
    expect(fromTs).toBe(c.expected);
  });

  it('기본 입력(surveys 열 · now())으로 목록 조회에 그대로 꽂힌다', async () => {
    const rows = await db
      .select({ lifecycle: surveyListLifecycleSql() })
      .from(surveys)
      .where(sql`${surveyListLifecycleSql()} = 'closed'`)
      .limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });
});

/**
 * 설문 목록 응답이 행마다 목록 상태를 싣는다 — 화면의 세그먼트 숫자·거르기가 이 값을 본다.
 * 종료 스위치를 안 눌러도 마감일이 지난 배포 설문은 「종료」, 중단은 「진행중」.
 */
describe.skipIf(!isLocalDb)('설문 목록 — 행마다 목록 상태', () => {
  const OWNER_ID = crypto.randomUUID();
  const TEAM_ID = crypto.randomUUID();
  const owner = { id: OWNER_ID, isSuperadmin: false, userType: 'internal' as const };
  const ids = {
    draftPastDue: crypto.randomUUID(),
    running: crypto.randomUUID(),
    paused: crypto.randomUUID(),
    pastDue: crypto.randomUUID(),
    closed: crypto.randomUUID(),
  };
  const past = new Date(Date.now() - 86_400_000);
  const future = new Date(Date.now() + 86_400_000);

  async function seed(
    id: string,
    status: 'draft' | 'published' | 'closed',
    over: { endDate?: Date | null; isPaused?: boolean } = {},
  ) {
    await db.insert(surveys).values({
      id,
      title: `목록 상태 ${id.slice(0, 4)}`,
      status,
      teamId: TEAM_ID,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
      endDate: over.endDate ?? null,
      isPaused: over.isPaused ?? false,
    });
    if (status === 'draft') return;
    const [version] = await db
      .insert(surveyVersions)
      .values({ surveyId: id, versionNumber: 1, status: 'published' })
      .returning({ id: surveyVersions.id });
    await db.update(surveys).set({ currentVersionId: version!.id }).where(eq(surveys.id, id));
  }

  beforeAll(async () => {
    await db.insert(usersTable).values({
      id: OWNER_ID,
      name: '목록상태',
      email: `list-lifecycle-${OWNER_ID}@example.com`,
      emailVerified: true,
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
    });
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `목록상태팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembersTable).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'member' });
    await seed(ids.draftPastDue, 'draft', { endDate: past });
    await seed(ids.running, 'published', { endDate: future });
    await seed(ids.paused, 'published', { isPaused: true });
    await seed(ids.pastDue, 'published', { endDate: past });
    await seed(ids.closed, 'closed');
  });

  afterAll(async () => {
    await db.delete(surveys).where(inArray(surveys.id, Object.values(ids)));
    await db.delete(teamMembersTable).where(eq(teamMembersTable.userId, OWNER_ID));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(eq(usersTable.id, OWNER_ID));
  });

  it('초안은 마감일 무관 작성중 · 중단은 진행중 · 마감일 경과와 종료 스위치는 종료', async () => {
    const list = await surveyReadSvc.getSurveyListWithCounts(owner, TEAM_ID);
    const byId = new Map(list.surveys.map((s) => [s.id, s.lifecycle]));
    expect(byId.get(ids.draftPastDue)).toBe('draft');
    expect(byId.get(ids.running)).toBe('running');
    expect(byId.get(ids.paused)).toBe('running');
    expect(byId.get(ids.pastDue)).toBe('closed');
    expect(byId.get(ids.closed)).toBe('closed');
  });
});
