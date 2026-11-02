/**
 * 설문 목록 페이지 조회 (설문 즐겨찾기·태그 티켓 03) — 실 로컬 DB.
 *
 * 거르기·정렬·페이지·숫자 세기를 서버가 SQL 로 한다. 목으로는 조건을 지워도 초록이 되므로
 * 실제 행으로 본다. 옛 클라이언트 목록 파이프라인(survey-list-pipeline)의 기대값을 여기로 옮겼다.
 *
 * 하나만 관찰 방식이 다르다 — 「응답 수는 페이지 항목만 센다」는 성능 계약이라, 응답 수 집계
 * 함수에 들어간 설문 id 수를 본다(PRD Testing Decisions 의 예외).
 */
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  surveyGroups as surveyGroupsTable,
  surveyParticipants as surveyParticipantsTable,
  surveyResponses as surveyResponsesTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { SurveyAccessError } from '@/server/survey-access';
import { listSurveyPage } from '@/server/survey-builder/services/survey-read';
import { WorkScopeError } from '@/server/work-scope';
import {
  INITIAL_ADVANCED_FILTERS,
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  SURVEY_LIST_PAGE_SIZE,
  type SurveyListPageInput,
} from '@/shared/contracts/survey-builder-io';
import { SYSTEM_SCOPE } from '@/shared/contracts/workspace';

// 응답 수 집계 함수를 감싸 「어떤 설문을 셌는가」만 기록한다 — 동작은 원본 그대로다.
const countedIds = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock('@/server/read-models/responses', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/read-models/responses')>();
  return {
    ...actual,
    getResponseCountsGroupedBySurvey: async (ids?: readonly string[]) => {
      countedIds.calls.push([...(ids ?? [])]);
      return actual.getResponseCountsGroupedBySurvey(ids);
    },
  };
});

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const VIEWER_ID = crypto.randomUUID();
const COLLEAGUE_ID = crypto.randomUUID();
const OUTSIDER_ID = crypto.randomUUID();
const SUPERADMIN_ID = crypto.randomUUID();
const TEAM_A = crypto.randomUUID();
const TEAM_B = crypto.randomUUID();
const GROUP_A = crypto.randomUUID();
const GROUP_EMPTY = crypto.randomUUID();
/** 이 실행에서만 쓰는 낱말 — 다른 스위트의 행과 섞이지 않게 검색으로 좁힐 때 쓴다. */
const RUN = `p${TEAM_A.slice(0, 8)}`;

const viewer = { id: VIEWER_ID, isSuperadmin: false, userType: 'internal' as const };
const superadmin = { id: SUPERADMIN_ID, isSuperadmin: true, userType: 'internal' as const };

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.parse('2026-06-01T00:00:00.000Z');

/** 페이지 경계용 30개 — bulk[i] 는 i 일째에 고쳤다(마지막이 최신). */
const bulk = Array.from({ length: 30 }, () => crypto.randomUUID());

const S = {
  /** 마감일이 지난 배포 설문 — 종료 스위치 없이 「종료」. */
  pastDue: crypto.randomUUID(),
  /** 종료 스위치를 켠 설문. */
  closed: crypto.randomUUID(),
  /** 중단된 배포 설문 — 「진행중」. */
  paused: crypto.randomUUID(),
  /** 마감일이 지난 초안 — 「작성중」. */
  draftPastDue: crypto.randomUUID(),
  /** 응답이 가장 많은 설문(5건) — 일부러 오래전에 고쳐 기본 정렬에서는 뒤쪽 페이지에 선다. */
  popular: crypto.randomUUID(),
  /** 카드 제목이 있는 설문 — 검색·정렬은 카드 제목을 본다. */
  carded: crypto.randomUUID(),
  /** 제목에 % 와 _ 가 든 설문. */
  literal: crypto.randomUUID(),
  /** 그룹에 든 설문. */
  grouped: crypto.randomUUID(),
  /** 동료 소유 invite_only — 팀원에게 안 보인다. */
  inviteOnly: crypto.randomUUID(),
  /** 삭제된 A팀 설문 — 일반 목록에 안 나오고 휴지통에만. */
  deleted: crypto.randomUUID(),
  /** B팀 설문 — 범위 밖. */
  otherTeam: crypto.randomUUID(),
  /** B팀 설문인데 viewer 가 초대됨 — 보인다(팀 좁힘 대상). */
  invited: crypto.randomUUID(),
  /** B팀 설문인데 viewer 가 초대됨, 그 팀 그룹에 든다. */
  invitedGrouped: crypto.randomUUID(),
};
const GROUP_B = crypto.randomUUID();
const allSurveyIds = [...bulk, ...Object.values(S)];

function query(over: Partial<SurveyListPageInput> = {}): SurveyListPageInput {
  return { ...INITIAL_SURVEY_LIST_PAGE_QUERY, scope: TEAM_A, ...over };
}

async function seedUser(id: string, name: string, isSuperadmin = false): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name,
    email: `list-page-${id}@example.com`,
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

async function seedResponses(surveyId: string, n: number): Promise<void> {
  await db.insert(surveyResponsesTable).values(
    Array.from({ length: n }, () => ({
      surveyId,
      questionResponses: {},
      isTest: false,
    })),
  );
}

describe.skipIf(!isLocalDb)('설문 목록 페이지 조회 (real local DB)', () => {
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
    await db.insert(surveyGroupsTable).values([
      { id: GROUP_A, teamId: TEAM_A, name: '2026', createdBy: COLLEAGUE_ID },
      { id: GROUP_EMPTY, teamId: TEAM_A, name: '빈 폴더', createdBy: COLLEAGUE_ID },
      { id: GROUP_B, teamId: TEAM_B, name: '협업', createdBy: OUTSIDER_ID },
    ]);

    const past = new Date(Date.now() - 3 * DAY);
    const old = new Date(BASE - 100 * DAY);
    await db.insert(surveysTable).values([
      ...bulk.map((id, i) =>
        surveyRow(id, {
          teamId: TEAM_A,
          ownerUserId: VIEWER_ID,
          title: `${RUN} 묶음 ${String(i).padStart(2, '0')}`,
          createdAt: new Date(BASE + i * DAY),
          updatedAt: new Date(BASE + i * DAY),
        }),
      ),
      surveyRow(S.pastDue, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        status: 'published',
        currentVersionId: crypto.randomUUID(),
        endDate: past,
        updatedAt: old,
        createdAt: old,
      }),
      surveyRow(S.closed, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        status: 'closed',
        currentVersionId: crypto.randomUUID(),
        updatedAt: old,
        createdAt: old,
      }),
      surveyRow(S.paused, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        status: 'published',
        isPaused: true,
        currentVersionId: crypto.randomUUID(),
        updatedAt: old,
        createdAt: old,
      }),
      surveyRow(S.draftPastDue, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        status: 'draft',
        endDate: past,
        updatedAt: old,
        createdAt: old,
      }),
      surveyRow(S.popular, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        updatedAt: new Date(BASE - 200 * DAY),
        createdAt: new Date(BASE - 200 * DAY),
      }),
      surveyRow(S.carded, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        title: `${RUN} 응답자용 긴 제목`,
        cardTitle: `${RUN} 가가 카드`,
        updatedAt: old,
        createdAt: old,
      }),
      surveyRow(S.literal, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        title: `${RUN} 100%_달성 조사`,
        updatedAt: old,
        createdAt: old,
      }),
      surveyRow(S.grouped, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        surveyGroupId: GROUP_A,
        visibility: 'team',
        updatedAt: old,
        createdAt: old,
      }),
      surveyRow(S.inviteOnly, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        visibility: 'invite_only',
        updatedAt: old,
        createdAt: old,
      }),
      surveyRow(S.deleted, {
        teamId: TEAM_A,
        ownerUserId: COLLEAGUE_ID,
        title: `${RUN} 지운 설문`,
        deletedAt: new Date(),
      }),
      surveyRow(S.otherTeam, { teamId: TEAM_B, ownerUserId: OUTSIDER_ID, updatedAt: old }),
      surveyRow(S.invited, { teamId: TEAM_B, ownerUserId: OUTSIDER_ID, updatedAt: old }),
      surveyRow(S.invitedGrouped, {
        teamId: TEAM_B,
        ownerUserId: OUTSIDER_ID,
        surveyGroupId: GROUP_B,
        updatedAt: old,
      }),
    ]);
    await db.insert(surveyParticipantsTable).values([
      { surveyId: S.invited, userId: VIEWER_ID, kind: 'member', addedBy: OUTSIDER_ID },
      { surveyId: S.invitedGrouped, userId: VIEWER_ID, kind: 'member', addedBy: OUTSIDER_ID },
    ]);
    await seedResponses(S.popular, 5);
    await seedResponses(bulk[0]!, 2);
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    await db
      .delete(surveyResponsesTable)
      .where(inArray(surveyResponsesTable.surveyId, allSurveyIds));
    await db
      .delete(surveyParticipantsTable)
      .where(inArray(surveyParticipantsTable.surveyId, allSurveyIds));
    await db.delete(surveysTable).where(inArray(surveysTable.id, allSurveyIds));
    await db
      .delete(surveyGroupsTable)
      .where(inArray(surveyGroupsTable.id, [GROUP_A, GROUP_EMPTY, GROUP_B]));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.teamId, [TEAM_A, TEAM_B]));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [TEAM_A, TEAM_B]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [VIEWER_ID, COLLEAGUE_ID, OUTSIDER_ID, SUPERADMIN_ID]));
  });

  beforeEach(() => {
    countedIds.calls = [];
  });

  describe('페이지', () => {
    it('24개씩 나눈다 — 1페이지와 2페이지가 겹치지 않고 합치면 결과 전부다', async () => {
      const first = await listSurveyPage(viewer, query({ q: '묶음' }));
      const second = await listSurveyPage(viewer, query({ q: '묶음', page: 2 }));

      expect(first.total).toBe(30);
      expect(first.totalPages).toBe(2);
      expect(first.items).toHaveLength(SURVEY_LIST_PAGE_SIZE);
      expect(second.page).toBe(2);
      expect(second.items).toHaveLength(6);
      // 최신 수정순 — 29일째가 맨 앞, 0일째가 맨 끝.
      expect(first.items[0]!.id).toBe(bulk[29]);
      expect(second.items.at(-1)!.id).toBe(bulk[0]);
      const ids = [...first.items, ...second.items].map((s) => s.id);
      expect(new Set(ids)).toEqual(new Set(bulk));
    });

    it('범위를 넘는 페이지는 마지막 페이지로 접힌다', async () => {
      const result = await listSurveyPage(viewer, query({ q: '묶음', page: 99 }));
      expect(result.page).toBe(2);
      expect(result.items).toHaveLength(6);
    });

    it('결과가 0개여도 1페이지로 선다', async () => {
      const result = await listSurveyPage(viewer, query({ q: `${RUN}-없는-낱말`, page: 3 }));
      expect(result).toMatchObject({ total: 0, page: 1, totalPages: 1, items: [] });
    });
  });

  // 여러 단어·설명·소유자 이름은 survey-list-search.realdb.test.ts (티켓 04).
  describe('검색', () => {
    it('카드 제목으로도, 카드 제목 뒤의 설문지 제목으로도 찾는다 — 대소문자 무시', async () => {
      const byCard = await listSurveyPage(viewer, query({ q: '가가 카드' }));
      expect(byCard.items.map((s) => s.id)).toEqual([S.carded]);
      const byHiddenTitle = await listSurveyPage(viewer, query({ q: '응답자용 긴 제목' }));
      expect(byHiddenTitle.items.map((s) => s.id)).toEqual([S.carded]);
      const upper = await listSurveyPage(viewer, query({ q: RUN.toUpperCase() + ' 묶음 07' }));
      expect(upper.items.map((s) => s.id)).toEqual([bulk[7]]);
    });

    it('% 와 _ 는 글자 그대로다', async () => {
      const percent = await listSurveyPage(viewer, query({ q: '100%_' }));
      expect(percent.items.map((s) => s.id)).toEqual([S.literal]);
      const underscore = await listSurveyPage(viewer, query({ q: `${RUN} 묶음 _` }));
      expect(underscore.total).toBe(0);
    });
  });

  describe('목록 상태', () => {
    it('마감일 지난 배포 설문과 종료 스위치는 종료, 중단은 진행중, 초안은 마감일과 무관하게 작성중', async () => {
      const closed = await listSurveyPage(viewer, query({ lifecycle: 'closed' }));
      const running = await listSurveyPage(viewer, query({ lifecycle: 'running' }));
      const draftOf = (id: string) =>
        listSurveyPage(viewer, query({ lifecycle: 'draft', q: id.slice(0, 6) }));

      expect(new Set(closed.items.map((s) => s.id))).toEqual(new Set([S.pastDue, S.closed]));
      expect(running.items.map((s) => s.id)).toEqual([S.paused]);
      expect((await draftOf(S.draftPastDue)).items.map((s) => s.id)).toEqual([S.draftPastDue]);
      expect((await draftOf(S.pastDue)).total).toBe(0);
    });

    it('상태별 숫자는 범위 기준이라 검색·상태·상세 검색에 흔들리지 않는다 — 전체 결과 수만 따라 줄어든다', async () => {
      const plain = await listSurveyPage(viewer, query());
      const narrowed = await listSurveyPage(
        viewer,
        query({
          q: '묶음',
          lifecycle: 'draft',
          advanced: { ...INITIAL_ADVANCED_FILTERS, ownerUserId: VIEWER_ID },
        }),
      );

      // A팀 범위에서 viewer 에게 보이는 것: 묶음 30 + 상태 4 + popular·carded·literal·grouped
      // + 초대 2(B팀). invite_only·삭제·타 팀은 빠진다.
      expect(plain.lifecycleCounts).toEqual({ all: 40, draft: 37, running: 1, closed: 2 });
      expect(narrowed.lifecycleCounts).toEqual(plain.lifecycleCounts);
      expect(plain.total).toBe(40);
      expect(narrowed.total).toBe(30);
    });
  });

  describe('응답 수', () => {
    it('기본 정렬에서는 보이는 페이지의 설문만 센다', async () => {
      const result = await listSurveyPage(viewer, query());

      expect(countedIds.calls).toHaveLength(1);
      expect(countedIds.calls[0]).toHaveLength(SURVEY_LIST_PAGE_SIZE);
      expect(new Set(countedIds.calls[0])).toEqual(new Set(result.items.map((s) => s.id)));
      // 0일째 묶음(응답 2건)은 1페이지 밖이라 세지 않았다.
      expect(countedIds.calls[0]).not.toContain(bulk[0]);
    });

    it('응답순 정렬은 범위 전체 기준이다 — 오래전에 고친 응답 많은 설문이 맨 앞에 온다', async () => {
      const result = await listSurveyPage(viewer, query({ sort: 'responses' }));

      expect(result.items[0]).toMatchObject({ id: S.popular, responseCount: 5 });
      expect(result.items[1]).toMatchObject({ id: bulk[0], responseCount: 2 });
      // 화면에 싣는 숫자는 여전히 페이지 항목만 센다.
      expect(countedIds.calls[0]).toHaveLength(SURVEY_LIST_PAGE_SIZE);
    });

    it('응답 수 범위는 범위 전체의 응답 수로 거른다', async () => {
      const result = await listSurveyPage(
        viewer,
        query({ advanced: { ...INITIAL_ADVANCED_FILTERS, responsesMin: 1, responsesMax: 4 } }),
      );
      expect(result.items.map((s) => s.id)).toEqual([bulk[0]]);
    });
  });

  describe('정렬', () => {
    it('생성일순은 최신 생성 먼저, 이름순은 카드에 보이는 이름의 가나다순', async () => {
      const created = await listSurveyPage(viewer, query({ q: '묶음', sort: 'createdAt' }));
      expect(created.items[0]!.id).toBe(bulk[29]);

      const titled = await listSurveyPage(viewer, query({ sort: 'title', q: RUN }));
      const names = titled.items.map((s) => s.cardTitle ?? s.title);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ko')));
      // 숫자로 시작하는 「100%…」 → 카드 제목 「가가 카드」 → 설문지 제목 「묶음 …」 순(한국어 정렬).
      expect(titled.items.slice(0, 3).map((s) => s.id)).toEqual([S.literal, S.carded, bulk[0]]);
    });
  });

  describe('상세 검색', () => {
    it('기간은 고른 기준 칸으로 한국 시간 하루 단위로 거르고, 기준 칸이 빈 설문은 뺀다', async () => {
      // bulk[i] 는 2026-06-01T00:00Z(=KST 09:00) + i 일. 6/3~6/4(KST) 는 bulk[2]·bulk[3].
      const ranged = await listSurveyPage(
        viewer,
        query({
          advanced: { ...INITIAL_ADVANCED_FILTERS, dateFrom: '2026-06-03', dateTo: '2026-06-04' },
        }),
      );
      expect(new Set(ranged.items.map((s) => s.id))).toEqual(new Set([bulk[2], bulk[3]]));

      const byEndDate = await listSurveyPage(
        viewer,
        query({
          advanced: {
            ...INITIAL_ADVANCED_FILTERS,
            dateField: 'endDate',
            dateFrom: '2000-01-01',
          },
        }),
      );
      expect(new Set(byEndDate.items.map((s) => s.id))).toEqual(
        new Set([S.pastDue, S.draftPastDue]),
      );
    });

    it('소유자·공개 범위를 함께 건다', async () => {
      const result = await listSurveyPage(
        viewer,
        query({
          advanced: { ...INITIAL_ADVANCED_FILTERS, ownerUserId: OUTSIDER_ID, visibility: 'team' },
        }),
      );
      expect(new Set(result.items.map((s) => s.id))).toEqual(
        new Set([S.invited, S.invitedGrouped]),
      );
    });

    it('소유자 목록은 범위 안 소유자 전부다 — 지금 페이지에 없는 소유자도 고를 수 있다', async () => {
      const result = await listSurveyPage(viewer, query());
      // 1페이지(최신 수정순)는 viewer 의 묶음뿐이지만 소유자 목록에는 동료·타 팀 소유자가 있다.
      expect(result.items.every((s) => s.ownerUserId === VIEWER_ID)).toBe(true);
      expect(result.owners.map((o) => o.id).sort()).toEqual(
        [VIEWER_ID, COLLEAGUE_ID, OUTSIDER_ID].sort(),
      );
      expect(result.owners.map((o) => o.name)).toEqual(
        [...result.owners.map((o) => o.name)].sort((a, b) => a.localeCompare(b, 'ko')),
      );
    });
  });

  describe('범위와 좁힘', () => {
    const invisible = [S.inviteOnly, S.deleted, S.otherTeam];

    it('볼 수 없는 설문은 어떤 조건에서도 나오지 않는다', async () => {
      const variants: Partial<SurveyListPageInput>[] = [
        {},
        { q: RUN },
        { lifecycle: 'draft' },
        { sort: 'responses' },
        { sort: 'title' },
        { teamId: TEAM_B },
        { teamId: TEAM_A, ungrouped: true },
        { advanced: { ...INITIAL_ADVANCED_FILTERS, ownerUserId: COLLEAGUE_ID } },
        { advanced: { ...INITIAL_ADVANCED_FILTERS, visibility: 'invite_only' } },
        { advanced: { ...INITIAL_ADVANCED_FILTERS, ownerUserId: OUTSIDER_ID } },
        { scope: TEAM_B },
      ];
      for (const variant of variants) {
        const first = await listSurveyPage(viewer, query(variant));
        const pages = [first];
        for (let p = 2; p <= first.totalPages; p++) {
          pages.push(await listSurveyPage(viewer, query({ ...variant, page: p })));
        }
        const ids = pages.flatMap((r) => r.items.map((s) => s.id));
        for (const id of invisible) expect(ids, JSON.stringify(variant)).not.toContain(id);
      }
    });

    it('그룹 화면은 그 그룹의 설문만, 숫자도 그 그룹에서 센다 — 빈 그룹은 0', async () => {
      const grouped = await listSurveyPage(viewer, query({ groupId: GROUP_A }));
      expect(grouped.items.map((s) => s.id)).toEqual([S.grouped]);
      expect(grouped.lifecycleCounts.all).toBe(1);

      const empty = await listSurveyPage(viewer, query({ groupId: GROUP_EMPTY }));
      expect(empty).toMatchObject({ total: 0, items: [] });
      expect(empty.lifecycleCounts.all).toBe(0);
    });

    it('초대받은 타 팀 설문은 그 팀 그룹으로도 좁혀진다(협업 그룹)', async () => {
      const result = await listSurveyPage(viewer, query({ groupId: GROUP_B }));
      expect(result.items.map((s) => s.id)).toEqual([S.invitedGrouped]);
    });

    it('팀 좁힘은 그 소유 팀 설문만, 미분류는 그 팀의 그룹 밖 설문만', async () => {
      const team = await listSurveyPage(viewer, query({ teamId: TEAM_B }));
      expect(new Set(team.items.map((s) => s.id))).toEqual(new Set([S.invited, S.invitedGrouped]));
      expect(team.activeTeam).toEqual({ id: TEAM_B, name: `${RUN} B팀` });
      expect(team.lifecycleCounts.all).toBe(2);

      const ungrouped = await listSurveyPage(viewer, query({ teamId: TEAM_B, ungrouped: true }));
      expect(ungrouped.items.map((s) => s.id)).toEqual([S.invited]);
    });

    it('지목한 팀의 설문이 범위에 없으면 좁히지 않는다 — 빈 화면에 갇히지 않게', async () => {
      const ghost = await listSurveyPage(viewer, query({ teamId: crypto.randomUUID() }));
      expect(ghost.activeTeam).toBeNull();
      expect(ghost.total).toBe(40);
    });

    it('일반 사용자의 system 요청은 거부된다', async () => {
      await expect(listSurveyPage(viewer, query({ scope: SYSTEM_SCOPE }))).rejects.toBeInstanceOf(
        WorkScopeError,
      );
    });
  });

  describe('휴지통', () => {
    it('슈퍼어드민 시스템 범위에서 같은 조회로 페이지·검색이 된다', async () => {
      const trash = await listSurveyPage(
        superadmin,
        query({ scope: SYSTEM_SCOPE, deleted: true, q: RUN }),
      );
      expect(trash.items.map((s) => s.id)).toEqual([S.deleted]);
      expect(trash.items[0]!.deletedAt).not.toBeNull();
      expect(trash.items[0]!.surveyGroupId).toBeNull();
      expect(trash.deletedCount).toBeGreaterThanOrEqual(1);
    });

    it('휴지통이 아닌 시스템 범위 목록에는 삭제된 설문이 없다', async () => {
      const live = await listSurveyPage(superadmin, query({ scope: SYSTEM_SCOPE, q: RUN }));
      expect(live.items.map((s) => s.id)).not.toContain(S.deleted);
      expect(live.total).toBe(42);
    });

    it('시스템 범위가 아니면 슈퍼어드민도 거부되고, 일반 사용자는 언제나 거부된다', async () => {
      await expect(
        listSurveyPage(superadmin, query({ scope: TEAM_A, deleted: true })),
      ).rejects.toBeInstanceOf(SurveyAccessError);
      await expect(listSurveyPage(viewer, query({ deleted: true }))).rejects.toBeInstanceOf(
        SurveyAccessError,
      );
    });
  });
});
