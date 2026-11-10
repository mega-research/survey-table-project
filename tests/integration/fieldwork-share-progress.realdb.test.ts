/**
 * 응답 현황·진척 보고를 자기 몫으로 — 실 로컬 DB (fieldwork-multi-company 티켓 07, ADR-0035).
 *
 * 한 설문에 외주 링크 A·B·C·D 와 조사 대상 1–24.
 *  - A 의 담당 범위 1–10, B 의 담당 범위 9–20 — 9·10 은 **같이 맡은 대상**이다.
 *  - 21–24 는 어느 링크에도 없다. C 는 한 번도 나누지 않았고, D 는 나눴다가 0명이 됐다.
 *  - 응답: 완료 1·2·9·12·21, 이탈 3·13, 진행 중 4, 자격미달 14, 실사 완료 처리(결과코드만) 5·15,
 *    그리고 조사 대상에 묶이지 않은 공개 링크 응답 셋(완료 둘·이탈 하나).
 *
 * 각 링크 세션의 주체로 담당 범위를 해석해(`/fw` 페이지가 하는 그대로) 응답 현황·진척 보고의 숫자를
 * 부른다. 기대값은 위 배치에서 손으로 센 리터럴이다 — 서비스가 하는 계산을 테스트가 다시 하지 않는다.
 *
 * 실 DB 인 이유: 범위는 WHERE 의 서브쿼리다. 목이 돌려주는 행은 언제나 테스트가 정한 행이라 술어가
 * 무엇이든 통과한다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { createRouterClient } from '@orpc/server';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactAttempts,
  contactTargets,
  fieldworkLinkShares,
  surveyAccessLinks,
  surveyResponses,
  surveys,
  surveyVersions,
  teamMembers,
  teams,
  users,
} from '@/db/schema';
import { readFieldworkLinkSessions } from '@/lib/auth/access-link-session';
import { buildCanonicalSteps } from '@/lib/operations/page-dwell-format';
import { authenticateAccessLink, resolveLinkActor } from '@/server/access-link';
import type { ORPCContext } from '@/server/context';
import { type OperationsDataScope, loadOperationsDataScope } from '@/server/data-scope';
import { FIELDWORK_SHARE_ALL, type FieldworkShare, resolveFieldworkShare } from '@/server/fieldwork-share-scope';
import {
  aggregateDaily,
  aggregateDailyAvailableDates,
} from '@/server/operations/services/aggregate-daily';
import { aggregateStatus } from '@/server/operations/services/aggregate-status';
import { getDailyStats } from '@/server/operations/services/daily-stats';
import { getDropFunnel } from '@/server/operations/services/drop-funnel';
import { getPageDwell } from '@/server/operations/services/page-dwell';
import {
  countContactTargets,
  getProgressRows,
  getProgressTotals,
} from '@/server/operations/services/report-progress';
import { getResponseTime } from '@/server/operations/services/response-time';
import { router } from '@/server/router';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';

// 요청 밖이라 「테스트 데이터 보기」 쿠키가 없다 — 연구원 화면은 실데이터를 본다(server/data-scope).
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: async () => ({ get: () => undefined }),
}));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

const OWNER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();
const QUESTION_ID = crypto.randomUUID();

const SNAPSHOT = {
  questions: [{ id: QUESTION_ID, order: 1, title: '문1', type: 'text' }],
  groups: [],
} as unknown as SurveyVersionSnapshot;

const SCHEME: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: '지역', label: '지역', source: 'attrs.지역', order: 2 },
  ],
};

const owner = createRouterClient(router, {
  context: {
    db,
    user: {
      id: OWNER_ID,
      email: `progress-${OWNER_ID}@example.com`,
      name: '연구원',
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
    },
  } satisfies ORPCContext,
});

interface SignedLink {
  linkId: string;
  token: string;
  cookie: { name: string; value: string };
}

function cookieHeaders(cookie: { name: string; value: string }): Headers {
  return new Headers({ cookie: `${cookie.name}=${cookie.value}` });
}

let surveyId = '';
let A: SignedLink;
let B: SignedLink;
let C: SignedLink;
let D: SignedLink;
const targetIdByResid = new Map<number, string>();

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

async function issueAndSignIn(label: string): Promise<SignedLink> {
  const { link, password } = await owner.workspace.accessLinks.issue({
    surveyId,
    kind: 'fieldwork',
    label,
  });
  const auth = await authenticateAccessLink(link.token, password);
  if (!auth.ok) throw new Error(`접속 실패: ${auth.reason}`);
  return { linkId: link.id, token: link.token, cookie: auth.cookie };
}

/**
 * 링크의 담당 범위를 이 시스템ID 들로 맞춘다 — 「나눈 적 있음」도 세운다.
 *
 * 나누기 적용 RPC 를 거치지 않는 것은 「같이 맡기기」를 깔기 위해서다(겹침 처리는 티켓 04 의 입력이다).
 * 이 스위트가 보는 것은 읽는 쪽이고, 쓰는 쪽 의미론은 `fieldwork-share.realdb` 가 본다.
 */
async function setShare(link: SignedLink, resids: number[]): Promise<void> {
  await db.delete(fieldworkLinkShares).where(eq(fieldworkLinkShares.linkId, link.linkId));
  if (resids.length > 0) {
    await db.insert(fieldworkLinkShares).values(
      resids.map((resid) => ({ linkId: link.linkId, contactTargetId: targetIdByResid.get(resid)! })),
    );
  }
  await db
    .update(surveyAccessLinks)
    .set({ shareAppliedAt: new Date(), shareClauses: [] })
    .where(eq(surveyAccessLinks.id, link.linkId));
}

/** `/fw/<token>/operations/{overview,report}` 페이지가 하는 그대로 — 세션 주체에서 파티션과 담당 범위를 푼다. */
async function viewOf(link: SignedLink): Promise<{ scope: OperationsDataScope; share: FieldworkShare }> {
  const session = await resolveLinkActor(link.token, cookieHeaders(link.cookie));
  if (!session.ok) throw new Error(`세션 실패: ${session.reason}`);
  return {
    scope: await loadOperationsDataScope(surveyId, session.actor),
    share: resolveFieldworkShare(session.actor, surveyId),
  };
}

/** 내부 콘솔 — 계정 주체는 담당 범위 축이 없다. */
const INTERNAL = { scope: 'real' as OperationsDataScope, share: FIELDWORK_SHARE_ALL };

/** 응답 현황 화면이 그리는 숫자 — KPI 줄·일자별 추이·일자별 통계·응답시간·이탈 위치·페이지 체류. */
async function overviewOf(view: { scope: OperationsDataScope; share: FieldworkShare }) {
  const { scope, share } = view;
  const [status, daily, dates, dailyStats, responseTime, dropFunnel, pageDwell] = await Promise.all([
    aggregateStatus(surveyId, scope, share),
    aggregateDaily({ surveyId, scope, share, mode: 'day' }),
    aggregateDailyAvailableDates(surveyId, scope, share),
    getDailyStats(surveyId, scope, share),
    getResponseTime(surveyId, scope, share),
    getDropFunnel(surveyId, scope, share),
    getPageDwell(surveyId, scope, share),
  ]);
  return {
    status,
    dailyCount: daily.reduce((sum, b) => sum + b.count, 0),
    dates: dates.length,
    dailyTotal: dailyStats.reduce((sum, r) => sum + r.total, 0),
    dailyCompleted: dailyStats.reduce((sum, r) => sum + r.completed, 0),
    timedResponses: responseTime.find((r) => r.scope === 'total')?.n ?? 0,
    drops: dropFunnel.totalDrops,
    dwellSamples: pageDwell.pages.reduce((sum, p) => sum + p.n, 0),
  };
}

/** 진척 보고 화면이 그리는 숫자 — 합계 줄과 그룹 행(업로드 그룹 = 지역). */
async function progressOf(view: { scope: OperationsDataScope; share: FieldworkShare }) {
  const { scope, share } = view;
  const [count, totals, rows] = await Promise.all([
    countContactTargets(surveyId, scope, share),
    getProgressTotals(surveyId, scope, share, null, []),
    getProgressRows({
      surveyId,
      scope,
      share,
      condition: null,
      page: 1,
      size: 50,
      sort: 'groupLabel',
      dir: 'asc',
      metaKeys: [],
      groupByKeys: [],
    }),
  ]);
  return {
    count,
    listTotal: totals.listTotal,
    completedTotal: totals.completedTotal,
    excludedTotal: totals.excludedTotal,
    groups: rows.map((r) => [r.groupLabel, r.listCount, r.completedCount] as const),
  };
}

function regionOf(resid: number): string {
  if (resid <= 10) return '서울';
  if (resid <= 20) return '부산';
  return '제주';
}

async function insertResponse(resid: number | null, status: string, isCompleted: boolean) {
  const stepId = buildCanonicalSteps(SNAPSHOT)[0]!.stepId;
  const enteredAt = new Date(Date.now() - 60_000).toISOString();
  const leftAt = new Date().toISOString();
  await db.insert(surveyResponses).values({
    surveyId,
    contactTargetId: resid === null ? null : targetIdByResid.get(resid)!,
    sessionId: `prog-${crypto.randomUUID()}`,
    questionResponses: {},
    status: status as 'completed',
    isCompleted,
    isTest: false,
    totalSeconds: isCompleted ? 60 : null,
    pageVisits: [{ stepId, enteredAt, leftAt }] as never,
  });
}

run('응답 현황·진척 보고를 자기 몫으로 (real DB)', () => {
  beforeAll(async () => {
    await db.insert(users).values({
      id: OWNER_ID,
      email: `progress-${OWNER_ID}@example.com`,
      name: '연구원',
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
      emailVerified: true,
    });
    await db.insert(teams).values({ id: TEAM_ID, name: `진척팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembers).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'leader' });
    surveyId = crypto.randomUUID();
    await db.insert(surveys).values({
      id: surveyId,
      title: '진척 보고 조사',
      teamId: TEAM_ID,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
      contactColumns: SCHEME,
      testContactColumns: SCHEME,
    });
    const versionId = crypto.randomUUID();
    await db.insert(surveyVersions).values({
      id: versionId,
      surveyId,
      versionNumber: 1,
      status: 'published',
      snapshot: SNAPSHOT as never,
    });
    await db.update(surveys).set({ currentVersionId: versionId }).where(eq(surveys.id, surveyId));

    const inserted = await db
      .insert(contactTargets)
      .values(
        range(1, 24).map((resid) => ({
          surveyId,
          resid,
          isTest: false,
          inviteCode: `pg${crypto.randomUUID().slice(0, 12)}`,
          groupValue: regionOf(resid),
          attrs: { 지역: regionOf(resid) },
        })),
      )
      .returning({ id: contactTargets.id, resid: contactTargets.resid });
    for (const r of inserted) targetIdByResid.set(r.resid, r.id);

    for (const resid of [1, 2, 9, 12, 21]) await insertResponse(resid, 'completed', true);
    for (const resid of [3, 13]) await insertResponse(resid, 'drop', false);
    await insertResponse(4, 'in_progress', false);
    await insertResponse(14, 'screened_out', false);
    // 공개 링크 응답 — 조사 대상에 묶이지 않는다.
    await insertResponse(null, 'completed', true);
    await insertResponse(null, 'completed', true);
    await insertResponse(null, 'drop', false);
    // 실사 완료 처리 — 온라인 응답 없이 완료 결과코드(기본 코드셋 「1.조사완료」)만.
    await db.insert(contactAttempts).values([
      { contactTargetId: targetIdByResid.get(5)!, attemptNo: 1, resultCode: '1.조사완료' },
      { contactTargetId: targetIdByResid.get(15)!, attemptNo: 1, resultCode: '1.조사완료' },
    ]);

    A = await issueAndSignIn('프롬');
    B = await issueAndSignIn('프라임');
    C = await issueAndSignIn('세번째');
    D = await issueAndSignIn('네번째');
  });

  beforeEach(async () => {
    await setShare(A, range(1, 10));
    await setShare(B, range(9, 20));
    await setShare(D, []);
  });

  afterAll(async () => {
    if (surveyId) {
      await db
        .delete(fieldworkLinkShares)
        .where(
          inArray(
            fieldworkLinkShares.linkId,
            [A, B, C, D].filter(Boolean).map((l) => l.linkId),
          ),
        );
      await db.delete(surveys).where(eq(surveys.id, surveyId));
    }
    await db.delete(teamMembers).where(eq(teamMembers.userId, OWNER_ID));
    await db.delete(teams).where(eq(teams.id, TEAM_ID));
    await db.delete(users).where(eq(users.id, OWNER_ID));
  });

  describe('응답 현황', () => {
    it('링크 A 의 숫자는 A 범위 대상의 응답만으로 센 값이다 — 같이 맡은 대상 포함, 공개 응답 제외', async () => {
      const a = await overviewOf(await viewOf(A));
      // A(1–10): 완료 1·2·9, 이탈 3, 진행 중 4, 실사 완료 처리 5
      expect(a.status).toEqual({
        total: 5,
        completed: 3,
        fieldworkCompleted: 1,
        screenedOut: 0,
        quotafulOut: 0,
        bad: 0,
        drop: 1,
        inProgress: 1,
      });
      expect(a.dailyCount).toBe(5);
      expect(a.dates).toBe(1);
      expect(a.dailyTotal).toBe(5);
      expect(a.dailyCompleted).toBe(3);
      expect(a.timedResponses).toBe(3);
      expect(a.drops).toBe(1);
      // 체류는 완료·이탈 응답의 방문만 — 1·2·9·3
      expect(a.dwellSamples).toBe(4);
    });

    it('링크 B 도 자기 몫만 — 같이 맡은 9 의 완료가 B 에도 들어간다', async () => {
      const b = await overviewOf(await viewOf(B));
      // B(9–20): 완료 9·12, 이탈 13, 자격미달 14, 실사 완료 처리 15
      expect(b.status).toEqual({
        total: 4,
        completed: 2,
        fieldworkCompleted: 1,
        screenedOut: 1,
        quotafulOut: 0,
        bad: 0,
        drop: 1,
        inProgress: 0,
      });
      expect(b.dailyTotal).toBe(4);
      expect(b.timedResponses).toBe(2);
      expect(b.drops).toBe(1);
    });

    it('나누지 않은 링크 C 와 내부 콘솔은 설문 전체 — 범위 밖 대상과 공개 응답까지 같은 숫자다', async () => {
      const internal = await overviewOf(INTERNAL);
      // 완료 1·2·9·12·21 + 공개 둘, 이탈 3·13 + 공개 하나, 진행 중 4, 자격미달 14, 실사 완료 처리 5·15
      expect(internal.status).toEqual({
        total: 12,
        completed: 7,
        fieldworkCompleted: 2,
        screenedOut: 1,
        quotafulOut: 0,
        bad: 0,
        drop: 3,
        inProgress: 1,
      });
      expect(internal.dailyTotal).toBe(12);
      expect(internal.timedResponses).toBe(7);
      expect(internal.drops).toBe(3);
      expect(await overviewOf(await viewOf(C))).toEqual(internal);
    });

    it('나눈 뒤 0명이 된 링크는 0 을 본다 — 설문 전체로 넓어지지 않는다', async () => {
      const d = await overviewOf(await viewOf(D));
      expect(d.status.total).toBe(0);
      expect(d.status.completed).toBe(0);
      expect(d.status.inProgress).toBe(0);
      expect(d.status.fieldworkCompleted).toBe(0);
      expect(d.dailyCount).toBe(0);
      expect(d.dates).toBe(0);
      expect(d.timedResponses).toBe(0);
      expect(d.drops).toBe(0);
      expect(d.dwellSamples).toBe(0);
    });

    it('대상을 B 에서 A 로 가져오면 끝난 응답도 따라 옮겨 간다 — 같은 세션의 다음 요청에', async () => {
      // 12(완료)·15(실사 완료 처리)를 A 로
      await setShare(A, [...range(1, 10), 12, 15]);
      await setShare(B, range(9, 20).filter((r) => r !== 12 && r !== 15));

      const a = await overviewOf(await viewOf(A));
      const b = await overviewOf(await viewOf(B));
      expect([a.status.completed, a.status.fieldworkCompleted]).toEqual([4, 2]);
      expect([b.status.completed, b.status.fieldworkCompleted]).toEqual([1, 0]);
    });
  });

  describe('진척 보고', () => {
    it('링크 A 의 합계·그룹 행은 A 범위 대상만으로 센 값이다 — 같이 맡은 대상 포함', async () => {
      const a = await progressOf(await viewOf(A));
      // 대상 1–10, 완료 W∪A = 온라인 1·2·9 + 결과코드 5
      expect(a).toEqual({
        count: 10,
        listTotal: 10,
        completedTotal: 4,
        excludedTotal: 0,
        groups: [['서울', 10, 4]],
      });
    });

    it('링크 B 의 진척에는 같이 맡은 9·10 이 들어가고 자격미달 14 는 모집단에서 빠진다', async () => {
      const b = await progressOf(await viewOf(B));
      // 대상 9–20(12명), 제외 14, 완료 9·12·15
      expect(b).toEqual({
        count: 12,
        listTotal: 11,
        completedTotal: 3,
        excludedTotal: 1,
        groups: [
          ['부산', 9, 2],
          ['서울', 2, 1],
        ],
      });
    });

    it('나누지 않은 링크 C 와 내부 콘솔은 설문 전체다', async () => {
      const internal = await progressOf(INTERNAL);
      expect(internal).toEqual({
        count: 24,
        listTotal: 23,
        completedTotal: 7,
        excludedTotal: 1,
        groups: [
          ['부산', 9, 2],
          ['서울', 10, 4],
          ['제주', 4, 1],
        ],
      });
      expect(await progressOf(await viewOf(C))).toEqual(internal);
    });

    it('나눈 뒤 0명이 된 링크는 빈 진척을 본다', async () => {
      expect(await progressOf(await viewOf(D))).toEqual({
        count: 0,
        listTotal: 0,
        completedTotal: 0,
        excludedTotal: 0,
        groups: [],
      });
    });

    it('대상 하나를 B 에서 A 로 가져오면 그 대상의 완료가 A 에 들어가고 B 에서 빠진다', async () => {
      await setShare(A, [...range(1, 10), 12]);
      await setShare(B, range(9, 20).filter((r) => r !== 12));

      const a = await progressOf(await viewOf(A));
      const b = await progressOf(await viewOf(B));
      expect([a.count, a.completedTotal]).toEqual([11, 5]);
      expect([b.count, b.completedTotal]).toEqual([11, 2]);
    });

    it('필터 후보의 값 목록도 범위 대상의 값만 담는다 — 남의 그룹 값이 새지 않는다', async () => {
      const values = async (link: SignedLink) => {
        const client = createRouterClient(router, {
          context: {
            db,
            user: null,
            headers: cookieHeaders(link.cookie),
            linkSessions: readFieldworkLinkSessions(cookieHeaders(link.cookie)),
          } satisfies ORPCContext,
        });
        const result = await client.contacts.attrValues.list({ surveyId, attrsKey: '지역' });
        return [...result.values].sort();
      };
      expect(await values(A)).toEqual(['서울']);
      expect(await values(B)).toEqual(['부산', '서울']);
      expect(await values(C)).toEqual(['부산', '서울', '제주']);
      expect(await values(D)).toEqual([]);
    });
  });
});
