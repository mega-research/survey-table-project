/**
 * 그룹 화면의 검색은 아래 전체에서 찾는다 (설문 그룹 중첩 티켓 08) — 실 로컬 DB.
 *
 * 그룹 좁힘의 범위가 검색어에 따라 갈린다: 검색어가 없으면 그 그룹에 직접 담긴 설문, 있으면 그 그룹과
 * 그 아래 전체. 세그먼트 숫자·별 숫자·소유자 목록도 같은 범위를 따르고, 아래 전체에서 찾은 설문에는
 * 그 그룹에서부터의 하위 그룹 경로가 실린다. 타 팀 그룹(협업 그룹)의 검색은 직접 담긴 설문만이다 —
 * 아래쪽 그룹 이름도 타 팀에 나가지 않는다.
 *
 * 조건이 전부 SQL 이라 목으로는 지워도 초록이 된다. 그룹 좁힘이 없는 목록·미분류의 기존 동작은
 * `survey-list-page.realdb.test.ts` 가 그대로 지킨다(이 스위트는 자기 팀·자기 그룹만 쓴다).
 */
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveyFavorites as surveyFavoritesTable,
  surveyGroups as surveyGroupsTable,
  surveyParticipants as surveyParticipantsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { listSurveyPage } from '@/server/survey-builder/services/survey-read';
import {
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  type SurveyListPageInput,
  type SurveyListPageResult,
} from '@/shared/contracts/survey-builder-io';
import { SYSTEM_SCOPE } from '@/shared/contracts/workspace';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const VIEWER_ID = crypto.randomUUID();
const COLLEAGUE_ID = crypto.randomUUID();
const OUTSIDER_ID = crypto.randomUUID();
const SUPERADMIN_ID = crypto.randomUUID();
const TEAM_A = crypto.randomUUID();
const TEAM_B = crypto.randomUUID();
/** 이 실행에서만 쓰는 낱말 — 모든 설문 제목에 들어 있어 「검색어 있음」을 만든다. */
const RUN = `g${TEAM_A.slice(0, 8)}`;

const viewer = { id: VIEWER_ID, isSuperadmin: false, userType: 'internal' as const };
const colleague = { id: COLLEAGUE_ID, isSuperadmin: false, userType: 'internal' as const };
const outsider = { id: OUTSIDER_ID, isSuperadmin: false, userType: 'internal' as const };
const superadmin = { id: SUPERADMIN_ID, isSuperadmin: true, userType: 'internal' as const };

/** A팀 그룹 — 이정운 › (2026 › 상반기) · 2025, 그리고 따로 선 최상위 「다른 폴더」. */
const G = {
  root: crypto.randomUUID(),
  y2026: crypto.randomUUID(),
  half: crypto.randomUUID(),
  y2025: crypto.randomUUID(),
  other: crypto.randomUUID(),
};
/** B팀 그룹 — 협업 › 협업 하위. viewer 는 두 그룹의 설문에 하나씩 초대돼 있다. */
const H = { root: crypto.randomUUID(), child: crypto.randomUUID() };

const S = {
  /** 이정운에 직접 담긴 설문 — viewer 소유. */
  direct: crypto.randomUUID(),
  /** 2026 에 담긴 설문 — 동료 소유, viewer 가 별을 켰다. */
  child: crypto.randomUUID(),
  /** 상반기(3단계)에 담긴 설문 — 동료 소유, 제목에 「손자」가 있다. */
  grand: crypto.randomUUID(),
  /** 2025 에 담긴 설문 — 배포된 설문(진행중). */
  sibling: crypto.randomUUID(),
  /** 상반기에 담긴 동료의 invite_only — viewer 에게 안 보인다. */
  hidden: crypto.randomUUID(),
  /** 2026 에 담긴 삭제된 설문. */
  deleted: crypto.randomUUID(),
  /** 다른 최상위 그룹의 설문 — 이정운 아래가 아니다. */
  elsewhere: crypto.randomUUID(),
  /** 미분류 설문. */
  ungrouped: crypto.randomUUID(),
  /** B팀 「협업」에 직접 담긴 설문 — viewer 초대됨. */
  foreignDirect: crypto.randomUUID(),
  /** B팀 「협업 하위」에 담긴 설문 — viewer 초대됨(보이지만 협업 그룹 검색에는 나오지 않는다). */
  foreignChild: crypto.randomUUID(),
};
const allSurveyIds = Object.values(S);

function query(over: Partial<SurveyListPageInput> = {}): SurveyListPageInput {
  return { ...INITIAL_SURVEY_LIST_PAGE_QUERY, scope: TEAM_A, whose: 'team', ...over };
}

function ids(result: SurveyListPageResult): Set<string> {
  return new Set(result.items.map((s) => s.id));
}

/** 설문 id → 그 카드에 실린 경로. */
function paths(result: SurveyListPageResult): Record<string, string[]> {
  return Object.fromEntries(result.items.map((s) => [s.id, s.groupPath]));
}

async function seedUser(id: string, name: string, isSuperadmin = false): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name,
    email: `list-subtree-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin,
    userType: 'internal',
  });
}

type SurveyValues = Partial<typeof surveysTable.$inferInsert> & {
  teamId: string;
  ownerUserId: string;
};

function surveyRow(id: string, values: SurveyValues) {
  return {
    id,
    title: `${RUN} 설문-${id.slice(0, 6)}`,
    visibility: 'team' as const,
    assignmentStatus: 'assigned' as const,
    createdBy: values.ownerUserId,
    ...values,
  };
}

describe.skipIf(!isLocalDb)('그룹 화면의 검색 범위 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(VIEWER_ID, `${RUN} 팀원`);
    await seedUser(COLLEAGUE_ID, `${RUN} 강동료`);
    await seedUser(OUTSIDER_ID, `${RUN} 나타팀`);
    await seedUser(SUPERADMIN_ID, `${RUN} 관리자`, true);
    await db.insert(teamsTable).values([
      { id: TEAM_A, name: `${RUN} A팀` },
      { id: TEAM_B, name: `${RUN} B팀` },
    ]);
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_A, userId: VIEWER_ID, role: 'member' },
      { teamId: TEAM_A, userId: COLLEAGUE_ID, role: 'member' },
      { teamId: TEAM_B, userId: OUTSIDER_ID, role: 'member' },
    ]);
    // 부모가 먼저 서야 한다(복합 FK) — 단계별로 넣는다.
    await db.insert(surveyGroupsTable).values([
      { id: G.root, teamId: TEAM_A, name: '이정운', createdBy: COLLEAGUE_ID },
      { id: G.other, teamId: TEAM_A, name: '다른 폴더', createdBy: COLLEAGUE_ID },
      { id: H.root, teamId: TEAM_B, name: '협업', createdBy: OUTSIDER_ID },
    ]);
    await db.insert(surveyGroupsTable).values([
      {
        id: G.y2026,
        teamId: TEAM_A,
        name: '2026',
        parentGroupId: G.root,
        parentDepth: 1,
        createdBy: COLLEAGUE_ID,
      },
      {
        id: G.y2025,
        teamId: TEAM_A,
        name: '2025',
        parentGroupId: G.root,
        parentDepth: 1,
        createdBy: COLLEAGUE_ID,
      },
      {
        id: H.child,
        teamId: TEAM_B,
        name: '협업 하위',
        parentGroupId: H.root,
        parentDepth: 1,
        createdBy: OUTSIDER_ID,
      },
    ]);
    await db.insert(surveyGroupsTable).values({
      id: G.half,
      teamId: TEAM_A,
      name: '상반기',
      parentGroupId: G.y2026,
      parentDepth: 2,
      createdBy: COLLEAGUE_ID,
    });

    await db.insert(surveysTable).values([
      surveyRow(S.direct, { teamId: TEAM_A, ownerUserId: VIEWER_ID, surveyGroupId: G.root }),
      surveyRow(S.child, { teamId: TEAM_A, ownerUserId: COLLEAGUE_ID, surveyGroupId: G.y2026 }),
      surveyRow(S.grand, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        surveyGroupId: G.half,
        title: `${RUN} 손자 설문`,
      }),
      surveyRow(S.sibling, {
        teamId: TEAM_A,
        ownerUserId: VIEWER_ID,
        surveyGroupId: G.y2025,
        status: 'published',
        currentVersionId: crypto.randomUUID(),
      }),
      surveyRow(S.hidden, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        surveyGroupId: G.half,
        visibility: 'invite_only',
      }),
      surveyRow(S.deleted, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        surveyGroupId: G.y2026,
        deletedAt: new Date(),
      }),
      surveyRow(S.elsewhere, { teamId: TEAM_A, ownerUserId: VIEWER_ID, surveyGroupId: G.other }),
      surveyRow(S.ungrouped, { teamId: TEAM_A, ownerUserId: VIEWER_ID }),
      surveyRow(S.foreignDirect, {
        teamId: TEAM_B,
        ownerUserId: OUTSIDER_ID,
        surveyGroupId: H.root,
      }),
      surveyRow(S.foreignChild, {
        teamId: TEAM_B,
        ownerUserId: OUTSIDER_ID,
        surveyGroupId: H.child,
      }),
    ]);
    await db.insert(surveyParticipantsTable).values([
      { surveyId: S.foreignDirect, userId: VIEWER_ID, kind: 'member', addedBy: OUTSIDER_ID },
      { surveyId: S.foreignChild, userId: VIEWER_ID, kind: 'member', addedBy: OUTSIDER_ID },
    ]);
    await db.insert(surveyFavoritesTable).values({ userId: VIEWER_ID, surveyId: S.child });
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    await db
      .delete(surveyParticipantsTable)
      .where(inArray(surveyParticipantsTable.surveyId, allSurveyIds));
    await db.delete(surveysTable).where(inArray(surveysTable.id, allSurveyIds));
    // 부모와 자식을 한 문장으로 지운다(ON DELETE NO ACTION).
    await db
      .delete(surveyGroupsTable)
      .where(inArray(surveyGroupsTable.id, [...Object.values(G), ...Object.values(H)]));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.teamId, [TEAM_A, TEAM_B]));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [TEAM_A, TEAM_B]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [VIEWER_ID, COLLEAGUE_ID, OUTSIDER_ID, SUPERADMIN_ID]));
  });

  describe('검색어 없음 — 직접 담긴 설문만', () => {
    it('그룹 좁힘은 그 그룹에 직접 담긴 설문만 내고 경로는 비어 있다', async () => {
      const result = await listSurveyPage(viewer, query({ groupId: G.root }));
      expect(result.items.map((s) => s.id)).toEqual([S.direct]);
      expect(paths(result)).toEqual({ [S.direct]: [] });
      expect(result.groupSubtree).toBe(false);
    });

    it('숫자와 소유자 목록도 직접 담긴 설문만 센다', async () => {
      const result = await listSurveyPage(viewer, query({ groupId: G.root }));
      expect(result.lifecycleCounts).toEqual({ all: 1, draft: 1, running: 0, closed: 0 });
      expect(result.favoriteCount).toBe(0);
      expect(result.owners.map((o) => o.id)).toEqual([VIEWER_ID]);
    });

    it('공백뿐인 검색어는 검색어가 아니다', async () => {
      const result = await listSurveyPage(viewer, query({ groupId: G.root, q: '   ' }));
      expect(result.items.map((s) => s.id)).toEqual([S.direct]);
      expect(result.groupSubtree).toBe(false);
    });

    it('검색어 없이 다른 조건(목록 상태·즐겨찾기)만 걸면 범위는 넓어지지 않는다', async () => {
      const running = await listSurveyPage(
        viewer,
        query({ groupId: G.root, lifecycle: 'running' }),
      );
      expect(running.total).toBe(0);
      const starred = await listSurveyPage(viewer, query({ groupId: G.root, favorites: true }));
      expect(starred.total).toBe(0);
      expect(starred.groupSubtree).toBe(false);
    });
  });

  describe('검색어 있음 — 그 그룹과 아래 전체', () => {
    it('하위·손자 그룹의 설문까지 내고, 설문마다 그 그룹에서부터의 경로가 실린다', async () => {
      const result = await listSurveyPage(viewer, query({ groupId: G.root, q: RUN }));
      expect(result.groupSubtree).toBe(true);
      expect(paths(result)).toEqual({
        [S.direct]: [],
        [S.child]: ['2026'],
        [S.grand]: ['2026', '상반기'],
        [S.sibling]: ['2025'],
      });
    });

    it('경로는 뿌리가 아니라 좁힌 그룹에서부터다', async () => {
      const mid = await listSurveyPage(viewer, query({ groupId: G.y2026, q: RUN }));
      expect(paths(mid)).toEqual({ [S.child]: [], [S.grand]: ['상반기'] });

      const leaf = await listSurveyPage(viewer, query({ groupId: G.half, q: RUN }));
      expect(paths(leaf)).toEqual({ [S.grand]: [] });
    });

    it('아래 전체에서도 검색어가 맞는 설문만 나온다', async () => {
      const result = await listSurveyPage(viewer, query({ groupId: G.root, q: '손자' }));
      expect(paths(result)).toEqual({ [S.grand]: ['2026', '상반기'] });
      expect(result.total).toBe(1);
    });

    it('다른 가지의 그룹과 미분류 설문은 끌려오지 않는다', async () => {
      const result = await listSurveyPage(viewer, query({ groupId: G.root, q: RUN }));
      expect(ids(result)).not.toContain(S.elsewhere);
      expect(ids(result)).not.toContain(S.ungrouped);

      const branch = await listSurveyPage(viewer, query({ groupId: G.y2025, q: RUN }));
      expect(branch.items.map((s) => s.id)).toEqual([S.sibling]);
    });

    it('세그먼트 숫자·별 숫자·소유자 목록이 같은 범위를 따른다', async () => {
      // 카드는 한 장(검색어)이지만 숫자는 좁힘 기준이다 — 그 좁힘이 아래 전체로 넓어졌다.
      const result = await listSurveyPage(viewer, query({ groupId: G.root, q: '손자' }));
      expect(result.lifecycleCounts).toEqual({ all: 4, draft: 3, running: 1, closed: 0 });
      expect(result.favoriteCount).toBe(1);
      expect(new Set(result.owners.map((o) => o.id))).toEqual(new Set([VIEWER_ID, COLLEAGUE_ID]));
    });

    it('목록 상태·즐겨찾기 조건은 넓어진 범위 안에서 거른다', async () => {
      const running = await listSurveyPage(
        viewer,
        query({ groupId: G.root, q: RUN, lifecycle: 'running' }),
      );
      expect(paths(running)).toEqual({ [S.sibling]: ['2025'] });

      const starred = await listSurveyPage(
        viewer,
        query({ groupId: G.root, q: RUN, favorites: true }),
      );
      expect(paths(starred)).toEqual({ [S.child]: ['2026'] });
    });

    it('「내 설문」은 넓어진 범위 안의 내 설문만 — 숫자도 그 기준이다', async () => {
      const result = await listSurveyPage(
        viewer,
        query({ groupId: G.root, q: RUN, whose: 'mine' }),
      );
      expect(ids(result)).toEqual(new Set([S.direct, S.sibling]));
      expect(result.lifecycleCounts.all).toBe(2);
      expect(result.teamWideTotal).toBe(4);
    });
  });

  describe('가시성', () => {
    it('아래 전체에서 찾아도 내가 볼 수 없는 설문은 나오지 않고 세지도 않는다', async () => {
      const result = await listSurveyPage(viewer, query({ groupId: G.root, q: RUN }));
      expect(ids(result)).toEqual(new Set([S.direct, S.child, S.grand, S.sibling]));
      expect(ids(result)).not.toContain(S.hidden);
      expect(ids(result)).not.toContain(S.deleted);
      expect(result.total).toBe(4);
      expect(result.lifecycleCounts.all).toBe(4);
    });

    it('그 설문의 소유자에게는 같은 검색에서 경로와 함께 나온다', async () => {
      const result = await listSurveyPage(colleague, query({ groupId: G.root, q: RUN }));
      expect(paths(result)[S.hidden]).toEqual(['2026', '상반기']);
      expect(result.lifecycleCounts.all).toBe(5);
    });

    it('남의 팀 사람이 그 그룹 id 로 검색해도 아무것도 나오지 않는다', async () => {
      const result = await listSurveyPage(
        outsider,
        query({ scope: TEAM_B, groupId: G.root, q: RUN }),
      );
      expect(result).toMatchObject({ total: 0, items: [], groupSubtree: false });
      expect(result.lifecycleCounts.all).toBe(0);
      expect(result.owners).toEqual([]);
    });
  });

  describe('타 팀 그룹(협업 그룹)', () => {
    it('검색은 직접 담긴 설문만 내고 경로를 내지 않는다 — 아래쪽 그룹의 볼 수 있는 설문도 끌려오지 않는다', async () => {
      const result = await listSurveyPage(viewer, query({ groupId: H.root, q: RUN }));
      expect(paths(result)).toEqual({ [S.foreignDirect]: [] });
      expect(result.groupSubtree).toBe(false);
      expect(result.lifecycleCounts.all).toBe(1);
      // 아래쪽 그룹 이름은 응답 어디에도 없다.
      expect(JSON.stringify(result)).not.toContain('협업 하위');
    });

    it('아래쪽 협업 그룹은 자기 주소로는 지금처럼 열린다', async () => {
      const result = await listSurveyPage(viewer, query({ groupId: H.child, q: RUN }));
      expect(paths(result)).toEqual({ [S.foreignChild]: [] });
    });

    it('그 팀 사람에게는 같은 그룹의 검색이 아래 전체다', async () => {
      const result = await listSurveyPage(
        outsider,
        query({ scope: TEAM_B, groupId: H.root, q: RUN }),
      );
      expect(paths(result)).toEqual({
        [S.foreignDirect]: [],
        [S.foreignChild]: ['협업 하위'],
      });
    });
  });

  describe('그룹 화면이 없는 목록', () => {
    it('시스템 전체 보기의 그룹 좁힘은 검색어가 있어도 직접 담긴 설문만이다', async () => {
      const result = await listSurveyPage(
        superadmin,
        query({ scope: SYSTEM_SCOPE, groupId: G.root, q: RUN }),
      );
      expect(paths(result)).toEqual({ [S.direct]: [] });
      expect(result.groupSubtree).toBe(false);
    });

    it('그룹 좁힘이 없는 검색에는 경로가 실리지 않는다', async () => {
      const result = await listSurveyPage(viewer, query({ q: RUN }));
      expect(result.groupSubtree).toBe(false);
      expect(ids(result)).toEqual(
        new Set([
          S.direct,
          S.child,
          S.grand,
          S.sibling,
          S.elsewhere,
          S.ungrouped,
          S.foreignDirect,
          S.foreignChild,
        ]),
      );
      expect(result.items.every((s) => s.groupPath.length === 0)).toBe(true);
    });

    it('미분류 좁힘은 검색어가 있어도 그룹 밖 설문만이다', async () => {
      const result = await listSurveyPage(
        viewer,
        query({ teamId: TEAM_A, ungrouped: true, q: RUN }),
      );
      expect(result.items.map((s) => s.id)).toEqual([S.ungrouped]);
    });
  });
});
