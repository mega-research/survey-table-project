/**
 * 설문 자동완성 후보 (설문 즐겨찾기·태그 티켓 05) — 실 로컬 DB.
 *
 * `suggestSurveys` 는 목록 페이지와 같은 검색 조각(`surveyListSearchSql`)과 같은 범위 필터를 타고
 * 최대 5건만 준다. 행 모양은 id·카드 제목·소유자 이름·목록 상태 넷뿐이다(응답 수 없음). 볼 수 없는
 * 설문이 후보로 새지 않는지는 목으로 볼 수 없어 실제 행으로 본다.
 */
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { suggestSurveys } from '@/server/survey-builder/services/survey-read';
import { SYSTEM_SCOPE } from '@/shared/contracts/workspace';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const VIEWER_ID = crypto.randomUUID();
const COLLEAGUE_ID = crypto.randomUUID();
const OUTSIDER_ID = crypto.randomUUID();
/** 팀에 속하지 않은 사람 — 아무것도 보지 않는 범위. */
const LONER_ID = crypto.randomUUID();
const TEAM_A = crypto.randomUUID();
const TEAM_B = crypto.randomUUID();
/** 이 실행에서만 쓰는 낱말 — 다른 스위트의 행과 섞이지 않게 모든 검색에 함께 건다. 숫자 없음. */
const RUN = `g${TEAM_A.replace(/[^a-f]/g, '').slice(0, 8)}`;

const viewer = { id: VIEWER_ID, isSuperadmin: false, userType: 'internal' as const };

/** 「실태」가 든 설문 7개 — 수정 시각이 1분씩 다르다(m0 이 가장 최근). */
const recent = Array.from({ length: 7 }, () => crypto.randomUUID());
const S = {
  /** 카드 제목이 따로 있다 — 후보에는 카드에 보이는 이름이 실린다. */
  carded: crypto.randomUUID(),
  /** 동료 소유 — 소유자 이름으로 찾는다. */
  colleagues: crypto.randomUUID(),
  /** 마감일이 지난 발행 설문 — 목록 상태 「종료」. */
  expired: crypto.randomUUID(),
  /** 동료 소유 invite_only — 낱말이 다 맞아도 팀원에게 안 보인다. */
  inviteOnly: crypto.randomUUID(),
  /** 다른 팀 설문. */
  otherTeam: crypto.randomUUID(),
  /** 삭제된 설문. */
  deleted: crypto.randomUUID(),
};
const allSurveyIds = [...recent, ...Object.values(S)];
const NOW = Date.now();

async function suggest(q: string, scope: string | null = TEAM_A) {
  return suggestSurveys(viewer, { scope, q });
}

describe.skipIf(!isLocalDb)('설문 자동완성 후보 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values(
      [
        [VIEWER_ID, `${RUN} 팀원`],
        [COLLEAGUE_ID, `${RUN} 강동료`],
        [OUTSIDER_ID, `${RUN} 나타팀`],
        [LONER_ID, `${RUN} 혼자`],
      ].map(([id, name]) => ({
        id: id!,
        name: name!,
        email: `list-suggest-${id}@example.com`,
        emailVerified: true,
        status: 'active' as const,
        isSuperadmin: false,
        userType: 'internal' as const,
      })),
    );
    await db.insert(teamsTable).values([
      { id: TEAM_A, name: `${RUN} A팀` },
      { id: TEAM_B, name: `${RUN} B팀` },
    ]);
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_A, userId: VIEWER_ID, role: 'member' },
      { teamId: TEAM_A, userId: COLLEAGUE_ID, role: 'member' },
      { teamId: TEAM_B, userId: OUTSIDER_ID, role: 'member' },
    ]);
    const row = (
      id: string,
      title: string,
      extra: Partial<typeof surveysTable.$inferInsert> = {},
    ) => ({
      id,
      title: `${RUN} ${title}`,
      teamId: TEAM_A,
      ownerUserId: VIEWER_ID,
      createdBy: VIEWER_ID,
      visibility: 'team' as const,
      assignmentStatus: 'assigned' as const,
      ...extra,
    });
    await db.insert(surveysTable).values([
      ...recent.map((id, i) =>
        row(id, `실태조사 m${i}`, { updatedAt: new Date(NOW - i * 60_000) }),
      ),
      row(S.carded, '응답자용 긴 제목', {
        cardTitle: `${RUN} 가가 카드`,
        updatedAt: new Date(NOW - 3_600_000),
      }),
      row(S.colleagues, '동료 설문', { ownerUserId: COLLEAGUE_ID, createdBy: COLLEAGUE_ID }),
      row(S.expired, '마감 지난 설문', {
        status: 'published',
        currentVersionId: crypto.randomUUID(),
        endDate: new Date(NOW - 86_400_000),
      }),
      row(S.inviteOnly, '숨은 실태조사', {
        ownerUserId: COLLEAGUE_ID,
        createdBy: COLLEAGUE_ID,
        visibility: 'invite_only',
      }),
      row(S.otherTeam, '남의 팀 실태조사', {
        teamId: TEAM_B,
        ownerUserId: OUTSIDER_ID,
        createdBy: OUTSIDER_ID,
      }),
      row(S.deleted, '지운 실태조사', { deletedAt: new Date() }),
    ]);
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    await db.delete(surveysTable).where(inArray(surveysTable.id, allSurveyIds));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.teamId, [TEAM_A, TEAM_B]));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [TEAM_A, TEAM_B]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [VIEWER_ID, COLLEAGUE_ID, OUTSIDER_ID, LONER_ID]));
  });

  it('맞는 설문 중 최근 수정 5건만, id·카드 제목·소유자 이름·목록 상태 넷만 준다', async () => {
    const result = await suggest(`${RUN} 실태`);
    expect(result.map((s) => s.id)).toEqual(recent.slice(0, 5));
    expect(result[0]).toEqual({
      id: recent[0],
      cardTitle: `${RUN} 실태조사 m0`,
      ownerName: `${RUN} 팀원`,
      lifecycle: 'draft',
    });
  });

  it('검색 의미는 목록과 같다 — 단어끼리 AND, 카드 제목·설문지 제목·소유자 이름', async () => {
    expect((await suggest(`${RUN} 가가 응답자용`)).map((s) => s.id)).toEqual([S.carded]);
    // 카드 제목이 있으면 후보 이름은 카드 제목이다.
    expect((await suggest(`${RUN} 응답자용`))[0]?.cardTitle).toBe(`${RUN} 가가 카드`);
    expect((await suggest(`강동료 ${RUN}`)).map((s) => s.id)).toEqual([S.colleagues]);
  });

  it('목록 상태는 목록과 같은 판정이다 — 마감일이 지난 발행 설문은 종료', async () => {
    const [hit] = await suggest(`${RUN} 마감`);
    expect(hit?.id).toBe(S.expired);
    expect(hit?.lifecycle).toBe('closed');
  });

  it('볼 수 없는 설문은 단어가 다 맞아도 후보에 안 나온다', async () => {
    for (const q of [`${RUN} 숨은`, `${RUN} 남의`, `${RUN} 지운`]) {
      expect(await suggest(q)).toEqual([]);
    }
  });

  it('빈 검색어(공백뿐 포함)는 조회 없이 빈 후보다', async () => {
    expect(await suggest('')).toEqual([]);
    expect(await suggest('   ')).toEqual([]);
  });

  it('팀이 없는 사람은 아무 후보도 받지 않는다', async () => {
    const loner = { id: LONER_ID, isSuperadmin: false, userType: 'internal' as const };
    expect(await suggestSurveys(loner, { scope: null, q: RUN })).toEqual([]);
  });

  it('일반 사용자의 시스템 범위 요청은 거부된다', async () => {
    await expect(suggest(RUN, SYSTEM_SCOPE)).rejects.toThrow();
  });
});
