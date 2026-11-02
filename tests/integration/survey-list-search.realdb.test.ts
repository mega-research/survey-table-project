/**
 * 설문 목록 여러 단어 검색 (설문 즐겨찾기·태그 티켓 04) — 실 로컬 DB.
 *
 * 검색어를 공백으로 나눈 단어마다 (카드 제목 | 설문지 제목 | 설명 | 소유자 이름) 부분일치, 단어끼리
 * AND. 조건 조각(`surveyListSearchSql`)을 목록 페이지 조회로 본다 — 목으로는 OR·AND 를 바꿔도
 * 초록이 되므로 실제 행으로 확인한다. 페이지·숫자·범위 일반은 survey-list-page.realdb.test.ts.
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
import { listSurveyPage } from '@/server/survey-builder/services/survey-read';
import {
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  type SurveyListPageInput,
} from '@/shared/contracts/survey-builder-io';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const VIEWER_ID = crypto.randomUUID();
const COLLEAGUE_ID = crypto.randomUUID();
/** 이름으로 검색되는 소유자 — 이 사람 설문의 제목·설명에는 그 이름이 없다. */
const STAR_ID = crypto.randomUUID();
const OUTSIDER_ID = crypto.randomUUID();
const TEAM_A = crypto.randomUUID();
const TEAM_B = crypto.randomUUID();
/**
 * 이 실행에서만 쓰는 낱말 — 다른 스위트의 행과 섞이지 않게 모든 검색에 한 단어로 함께 건다.
 * 숫자를 빼고 만든다: 「2026」 같은 검색 단어가 이 낱말 안에서 우연히 맞지 않게.
 */
const RUN = `s${TEAM_A.replace(/[^a-f]/g, '').slice(0, 8)}`;

const viewer = { id: VIEWER_ID, isSuperadmin: false, userType: 'internal' as const };

const S = {
  /** 「2026」과 「실태」가 떨어져 들어 있다. */
  both: crypto.randomUUID(),
  /** 「2026」만 들어 있다. */
  onlyYear: crypto.randomUUID(),
  /** 카드 제목과 설문지 제목이 다르다. */
  carded: crypto.randomUUID(),
  /** 설명에만 낱말이 있다. */
  described: crypto.randomUUID(),
  /** 소유자 이름으로만 찾을 수 있다. */
  starOwned: crypto.randomUUID(),
  /** 제목에 % 와 _ 가 있다. */
  literal: crypto.randomUUID(),
  /** 제목에 역슬래시가 있다. */
  backslash: crypto.randomUUID(),
  /** 동료 소유 invite_only — 낱말이 다 맞아도 팀원에게 안 보인다. */
  inviteOnly: crypto.randomUUID(),
  /** 다른 팀 설문 — 범위 밖. */
  otherTeam: crypto.randomUUID(),
  /** 삭제된 설문 — 일반 목록 밖. */
  deleted: crypto.randomUUID(),
};
const allSurveyIds = Object.values(S);

function query(q: string): SurveyListPageInput {
  return { ...INITIAL_SURVEY_LIST_PAGE_QUERY, scope: TEAM_A, q };
}

async function idsOf(q: string): Promise<string[]> {
  const result = await listSurveyPage(viewer, query(q));
  return result.items.map((s) => s.id);
}

describe.skipIf(!isLocalDb)('설문 목록 여러 단어 검색 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values(
      [
        [VIEWER_ID, `${RUN} 팀원`],
        [COLLEAGUE_ID, `${RUN} 강동료`],
        [STAR_ID, `${RUN} 소유한별`],
        [OUTSIDER_ID, `${RUN} 나타팀`],
      ].map(([id, name]) => ({
        id: id!,
        name: name!,
        email: `list-search-${id}@example.com`,
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
      { teamId: TEAM_A, userId: STAR_ID, role: 'member' },
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
      row(S.both, '2026년 인공지능산업 실태조사'),
      row(S.onlyYear, '2026년 만족도 조사'),
      row(S.carded, '응답자용 긴 제목', { cardTitle: `${RUN} 가가 카드` }),
      row(S.described, '설명이 있는 설문', { description: '발주 Ab사 납품 건' }),
      row(S.starOwned, '별 소유 설문', { ownerUserId: STAR_ID, createdBy: STAR_ID }),
      row(S.literal, '100%_달성 조사'),
      row(S.backslash, '경로 C:\\자료'),
      row(S.inviteOnly, '2026년 숨은 실태조사', {
        ownerUserId: COLLEAGUE_ID,
        createdBy: COLLEAGUE_ID,
        visibility: 'invite_only',
      }),
      row(S.otherTeam, '2026년 남의 팀 실태조사', {
        teamId: TEAM_B,
        ownerUserId: OUTSIDER_ID,
        createdBy: OUTSIDER_ID,
      }),
      row(S.deleted, '2026년 지운 실태조사', { deletedAt: new Date() }),
    ]);
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    await db.delete(surveysTable).where(inArray(surveysTable.id, allSurveyIds));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.teamId, [TEAM_A, TEAM_B]));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [TEAM_A, TEAM_B]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [VIEWER_ID, COLLEAGUE_ID, STAR_ID, OUTSIDER_ID]));
  });

  it('떨어진 두 단어를 모두 가진 설문만 맞는다', async () => {
    expect(await idsOf(`2026 ${RUN} 실태`)).toEqual([S.both]);
    // 한 단어만 걸면 둘 다 맞는다 — 위 결과가 AND 로 걸러진 것임을 대조로 본다(연속 공백도 한 칸).
    expect(new Set(await idsOf(`  ${RUN}   2026 `))).toEqual(new Set([S.both, S.onlyYear]));
  });

  it('카드 제목과 설문지 제목 어느 쪽으로도 찾고, 단어마다 다른 칸에서 맞아도 된다', async () => {
    expect(await idsOf(`${RUN} 가가 카드`)).toEqual([S.carded]);
    expect(await idsOf(`${RUN} 응답자용 제목`)).toEqual([S.carded]);
    expect(await idsOf(`${RUN} 가가 응답자용`)).toEqual([S.carded]);
  });

  it('설명으로 맞는다 — 대소문자 무시', async () => {
    expect(await idsOf(`${RUN} aB사`)).toEqual([S.described]);
    expect(await idsOf(`${RUN.toUpperCase()} AB사 납품`)).toEqual([S.described]);
  });

  it('소유자 이름으로 맞는다', async () => {
    expect(await idsOf(`소유한별 ${RUN}`)).toEqual([S.starOwned]);
  });

  it('% · _ · 역슬래시는 글자 그대로다', async () => {
    expect(await idsOf(`${RUN} 100%_`)).toEqual([S.literal]);
    // 와일드카드로 읽혔다면 모든 설문이 맞는다.
    expect(await idsOf(`${RUN} %`)).toEqual([S.literal]);
    expect(await idsOf(`${RUN} _`)).toEqual([S.literal]);
    expect(await idsOf(`${RUN} C:\\자료`)).toEqual([S.backslash]);
    expect(await idsOf(`${RUN} \\`)).toEqual([S.backslash]);
  });

  it('볼 수 없는 설문은 단어가 다 맞아도 안 맞는다', async () => {
    const ids = await idsOf(`${RUN} 2026 실태`);
    expect(ids).not.toContain(S.inviteOnly);
    expect(ids).not.toContain(S.otherTeam);
    expect(ids).not.toContain(S.deleted);
    expect(ids).toEqual([S.both]);
  });
});
