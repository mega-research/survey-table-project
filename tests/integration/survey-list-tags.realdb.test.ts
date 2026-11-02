/**
 * 설문 목록 태그로 거르기 (설문 즐겨찾기·태그 티켓 09) — 실 로컬 DB.
 *
 * 검색 칩(태그 id 목록)은 모두 붙은 설문만 남기고(AND), 요청자 소유가 아닌 태그 id 가 섞이면 조용히
 * 빼지 않고 거부한다. 글자 검색은 **요청자의** 태그 이름도 본다 — 동료의 태그 이름으로는 맞지 않는다.
 * 목으로는 AND·OR 를 바꾸거나 user_id 조건을 빼도 초록이 되므로 실제 행으로 본다.
 */
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  personalSurveyTagLinks as personalSurveyTagLinksTable,
  personalSurveyTags as personalSurveyTagsTable,
  surveyFavorites as surveyFavoritesTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { listSurveyPage, suggestSurveys } from '@/server/survey-builder/services/survey-read';
import {
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  type SurveyListPageInput,
} from '@/shared/contracts/survey-builder-io';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const VIEWER_ID = crypto.randomUUID();
const COLLEAGUE_ID = crypto.randomUUID();
const SUPERADMIN_ID = crypto.randomUUID();
const TEAM_A = crypto.randomUUID();
/** 이 실행에서만 쓰는 낱말 — 모든 검색에 한 단어로 함께 걸어 다른 스위트의 행과 섞이지 않게 한다. */
const RUN = `t${TEAM_A.replace(/[^a-f]/g, '').slice(0, 8)}`;

const viewer = { id: VIEWER_ID, isSuperadmin: false, userType: 'internal' as const };
const colleague = { id: COLLEAGUE_ID, isSuperadmin: false, userType: 'internal' as const };
const superadmin = { id: SUPERADMIN_ID, isSuperadmin: true, userType: 'internal' as const };

const S = {
  /** 내 태그 「발주」·「연도」가 둘 다 붙었다 — 진행중, 별 켬. */
  both: crypto.randomUUID(),
  /** 둘 다 붙었지만 작성중이고 별이 없다. */
  bothDraft: crypto.randomUUID(),
  /** 「발주」만. */
  onlyClient: crypto.randomUUID(),
  /** 「연도」만. */
  onlyYear: crypto.randomUUID(),
  /** 내 태그 없음 — 동료가 동료 태그 「동료꼬리표」를 붙였다. */
  colleagueTagged: crypto.randomUUID(),
  /** 휴지통 설문 — 슈퍼어드민이 지우기 전에 자기 태그 「휴지꼬리표」를 붙였다. */
  trashed: crypto.randomUUID(),
};
const allSurveyIds = Object.values(S);

/** 이름은 제목·설명·소유자에 없는 낱말이다 — 맞았다면 태그 이름으로 맞은 것이다. */
const TAG = {
  client: { id: crypto.randomUUID(), name: '오메가발주' },
  year: { id: crypto.randomUUID(), name: '연도이공' },
  /** 아무 설문에도 안 붙은 내 태그. */
  unused: { id: crypto.randomUUID(), name: '빈꼬리표' },
  colleague: { id: crypto.randomUUID(), name: '동료꼬리표' },
  /** 슈퍼어드민의 태그 — 휴지통 설문에만 붙었다. */
  trash: { id: crypto.randomUUID(), name: '휴지꼬리표' },
};

function query(over: Partial<SurveyListPageInput> = {}): SurveyListPageInput {
  return { ...INITIAL_SURVEY_LIST_PAGE_QUERY, scope: TEAM_A, q: RUN, ...over };
}

async function idsOf(over: Partial<SurveyListPageInput>, user = viewer): Promise<Set<string>> {
  const result = await listSurveyPage(user, query(over));
  return new Set(result.items.map((s) => s.id));
}

describe.skipIf(!isLocalDb)('설문 목록 태그로 거르기 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values(
      [
        [VIEWER_ID, `${RUN} 보는이`, false],
        [COLLEAGUE_ID, `${RUN} 같은팀`, false],
        [SUPERADMIN_ID, `${RUN} 관리자`, true],
      ].map(([id, name, isSuperadmin]) => ({
        id: id as string,
        name: name as string,
        email: `list-tags-${id as string}@example.com`,
        emailVerified: true,
        status: 'active' as const,
        isSuperadmin: isSuperadmin as boolean,
        userType: 'internal' as const,
      })),
    );
    await db.insert(teamsTable).values({ id: TEAM_A, name: `${RUN} A팀` });
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_A, userId: VIEWER_ID, role: 'member' },
      { teamId: TEAM_A, userId: COLLEAGUE_ID, role: 'member' },
    ]);
    const running = { status: 'published' as const, currentVersionId: crypto.randomUUID() };
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
    await db
      .insert(surveysTable)
      .values([
        row(S.both, '둘 다 붙은 설문', running),
        row(S.bothDraft, '둘 다 붙은 초안'),
        row(S.onlyClient, '발주만 붙은 설문', running),
        row(S.onlyYear, '연도만 붙은 설문', running),
        row(S.colleagueTagged, '동료가 표시한 설문', running),
        row(S.trashed, '지운 설문', { deletedAt: new Date() }),
      ]);
    await db.insert(personalSurveyTagsTable).values([
      { id: TAG.client.id, userId: VIEWER_ID, name: TAG.client.name, color: 'blue' },
      { id: TAG.year.id, userId: VIEWER_ID, name: TAG.year.name, color: 'gray' },
      { id: TAG.unused.id, userId: VIEWER_ID, name: TAG.unused.name, color: 'red' },
      { id: TAG.colleague.id, userId: COLLEAGUE_ID, name: TAG.colleague.name, color: 'green' },
      { id: TAG.trash.id, userId: SUPERADMIN_ID, name: TAG.trash.name, color: 'amber' },
    ]);
    await db.insert(personalSurveyTagLinksTable).values([
      { tagId: TAG.client.id, surveyId: S.both },
      { tagId: TAG.year.id, surveyId: S.both },
      { tagId: TAG.client.id, surveyId: S.bothDraft },
      { tagId: TAG.year.id, surveyId: S.bothDraft },
      { tagId: TAG.client.id, surveyId: S.onlyClient },
      { tagId: TAG.year.id, surveyId: S.onlyYear },
      { tagId: TAG.colleague.id, surveyId: S.colleagueTagged },
      { tagId: TAG.trash.id, surveyId: S.trashed },
    ]);
    await db.insert(surveyFavoritesTable).values([
      { userId: VIEWER_ID, surveyId: S.both },
      { userId: VIEWER_ID, surveyId: S.onlyClient },
    ]);
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    // 태그 연결·별은 설문·태그·사람 삭제에 연쇄로 지워진다.
    await db.delete(surveysTable).where(inArray(surveysTable.id, allSurveyIds));
    await db.delete(personalSurveyTagsTable).where(
      inArray(
        personalSurveyTagsTable.id,
        Object.values(TAG).map((t) => t.id),
      ),
    );
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.teamId, [TEAM_A]));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [TEAM_A]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [VIEWER_ID, COLLEAGUE_ID, SUPERADMIN_ID]));
  });

  describe('태그 조건', () => {
    it('두 태그를 걸면 둘 다 붙은 설문만 나온다', async () => {
      expect(await idsOf({ tagIds: [TAG.client.id, TAG.year.id] })).toEqual(
        new Set([S.both, S.bothDraft]),
      );
      // 하나만 걸면 그 태그가 붙은 설문 전부 — 위 결과가 AND 로 좁혀진 것임을 대조로 본다.
      expect(await idsOf({ tagIds: [TAG.client.id] })).toEqual(
        new Set([S.both, S.bothDraft, S.onlyClient]),
      );
    });

    it('동료의 태그 id 가 섞이면 조용히 빼지 않고 거부한다 — 없는 태그와 같은 not_found', async () => {
      await expect(
        listSurveyPage(viewer, query({ tagIds: [TAG.client.id, TAG.colleague.id] })),
      ).rejects.toMatchObject({ name: 'SurveyAccessError', reason: 'not_found' });
      await expect(
        listSurveyPage(viewer, query({ tagIds: [crypto.randomUUID()] })),
      ).rejects.toMatchObject({ name: 'SurveyAccessError', reason: 'not_found' });
      // 동료 본인에게는 동료 태그 조건이 그대로 동작한다 — 거부가 소유 때문임을 대조로 본다.
      expect(await idsOf({ tagIds: [TAG.colleague.id] }, colleague)).toEqual(
        new Set([S.colleagueTagged]),
      );
    });

    it('붙은 설문이 없는 내 태그로 걸면 0건이다(거부가 아니다)', async () => {
      const result = await listSurveyPage(viewer, query({ tagIds: [TAG.unused.id] }));
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('태그 + 즐겨찾기 + 목록 상태를 함께 걸면 모두 만족하는 설문만, 숫자는 범위 기준 그대로다', async () => {
      const plain = await listSurveyPage(viewer, query());
      const combined = await listSurveyPage(
        viewer,
        query({ tagIds: [TAG.client.id, TAG.year.id], favorites: true, lifecycle: 'running' }),
      );
      expect(combined.items.map((s) => s.id)).toEqual([S.both]);
      expect(combined.total).toBe(1);
      expect(combined.lifecycleCounts).toEqual(plain.lifecycleCounts);
      expect(combined.favoriteCount).toBe(plain.favoriteCount);
      // 별만 빼면 초안이 아니라서 빠진 bothDraft 는 여전히 빠지고, 상태만 빼면 별 없는 초안이 빠진다.
      expect(await idsOf({ tagIds: [TAG.client.id, TAG.year.id], lifecycle: 'running' })).toEqual(
        new Set([S.both]),
      );
      expect(await idsOf({ tagIds: [TAG.client.id], favorites: true })).toEqual(
        new Set([S.both, S.onlyClient]),
      );
    });

    it('휴지통에서는 태그 조건을 받지 않는다', async () => {
      await expect(
        listSurveyPage(
          superadmin,
          query({ scope: 'system', deleted: true, tagIds: [TAG.client.id] }),
        ),
      ).rejects.toMatchObject({ name: 'SurveyAccessError', reason: 'forbidden' });
    });

    it('카드의 내 태그 id 는 태그 조건과 무관하게 붙은 것 전부다', async () => {
      const result = await listSurveyPage(viewer, query({ tagIds: [TAG.year.id] }));
      const both = result.items.find((s) => s.id === S.both);
      expect(new Set(both?.myTagIds)).toEqual(new Set([TAG.client.id, TAG.year.id]));
    });
  });

  describe('글자 검색의 내 태그 이름', () => {
    it('내 태그 이름으로 맞는다 — 부분일치, 다른 단어와 AND', async () => {
      expect(await idsOf({ q: `${RUN} 오메가` })).toEqual(
        new Set([S.both, S.bothDraft, S.onlyClient]),
      );
      // 한 단어는 태그 이름, 다른 단어는 제목에서 맞아도 된다.
      expect(await idsOf({ q: `${RUN} 오메가 초안` })).toEqual(new Set([S.bothDraft]));
      // 두 단어가 서로 다른 태그 이름에서 맞으면 둘 다 붙은 설문만.
      expect(await idsOf({ q: `${RUN} 오메가 이공` })).toEqual(new Set([S.both, S.bothDraft]));
    });

    it('동료의 태그 이름으로는 맞지 않는다 — 동료 본인에게는 맞는다', async () => {
      expect(await idsOf({ q: `${RUN} 동료꼬리표` })).toEqual(new Set());
      expect(await idsOf({ q: `${RUN} 동료꼬리표` }, colleague)).toEqual(
        new Set([S.colleagueTagged]),
      );
    });

    it('휴지통에서는 태그 이름으로 맞지 않는다 — 카드에 태그가 없으니 이유 없이 맞는 결과가 된다', async () => {
      const trash = (q: string) =>
        listSurveyPage(superadmin, query({ scope: 'system', deleted: true, q }));
      expect((await trash(`${RUN} 휴지꼬리표`)).items).toEqual([]);
      // 같은 설문이 제목으로는 맞는다 — 빠진 것이 태그 이름 조각 때문임을 대조로 본다.
      expect((await trash(`${RUN} 지운`)).items.map((s) => s.id)).toEqual([S.trashed]);
    });

    it('자동완성 설문 후보도 같은 의미다 — 내 태그 이름으로 맞고 동료 태그 이름으로는 안 맞는다', async () => {
      const mine = await suggestSurveys(viewer, { scope: TEAM_A, q: `${RUN} 연도이공` });
      expect(new Set(mine.map((s) => s.id))).toEqual(new Set([S.both, S.bothDraft, S.onlyYear]));
      expect(await suggestSurveys(viewer, { scope: TEAM_A, q: `${RUN} 동료꼬리표` })).toEqual([]);
    });
  });
});
