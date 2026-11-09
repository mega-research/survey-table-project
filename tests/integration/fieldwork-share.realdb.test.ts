/**
 * 담당 범위 첫 줄기 — 실 로컬 DB (fieldwork-multi-company 티켓 03, ADR-0035).
 *
 * 한 설문에 외주 링크 A·B·C, 조사 대상 1–200. 연구원이 A 에 1–100, B 에 101–200 을 나누고, C 는 한 번도
 * 나누지 않는다. 각 링크 세션으로 **라우터 클라이언트**를 직접 부르고 `/fw` 조사 대상 목록의 조립
 * (`loadContactsListPage`)을 부른다 — 외주가 바깥에서 보는 결과만 단언한다.
 *
 * 실 DB 인 이유: 범위는 WHERE 의 서브쿼리다. 목이 돌려주는 행은 언제나 테스트가 정한 행이라 술어가
 * 무엇이든 통과한다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { createRouterClient } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactTargets,
  fieldworkLinkShares,
  surveyAccessLinks,
  surveyParticipants,
  surveys,
  teamMembers,
  teams,
  users,
} from '@/db/schema';
import { readFieldworkLinkSessions } from '@/lib/auth/access-link-session';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { authenticateAccessLink, resolveLinkActor } from '@/server/access-link';
import { applyAssignment } from '@/server/contacts/services/contact-assignment-apply';
import { createAssignment } from '@/server/contacts/services/contact-assignments';
import type { ORPCContext } from '@/server/context';
import { loadOperationsDataScope } from '@/server/data-scope';
import { resolveFieldworkShare } from '@/server/fieldwork-share';
import { loadSurveyAccess } from '@/server/survey-access';
import { loadContactsListPage } from '@/server/read-models/contacts-list-page';
import { router } from '@/server/router';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

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
/** 사내 실사원 — 다른 팀 소속의 전체 권한 참여자. 컨택원은 나누지만 담당 범위는 못 나눈다. */
const PARTICIPANT_ID = crypto.randomUUID();
const PARTICIPANT_TEAM_ID = crypto.randomUUID();

const SCHEME: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: '지역', label: '지역', source: 'attrs.지역', order: 2 },
    { key: '번호', label: '번호', source: 'attrs.번호', order: 3 },
  ],
};

function internalUser(id: string, name: string) {
  return {
    id,
    email: `share-${id}@example.com`,
    name,
    status: 'active' as const,
    isSuperadmin: false,
    userType: 'internal' as const,
  };
}

const owner = createRouterClient(router, {
  context: { db, user: internalUser(OWNER_ID, '연구원') } satisfies ORPCContext,
});
const participant = createRouterClient(router, {
  context: { db, user: internalUser(PARTICIPANT_ID, '사내 실사원') } satisfies ORPCContext,
});

function cookieHeaders(cookie: { name: string; value: string }): Headers {
  return new Headers({ cookie: `${cookie.name}=${cookie.value}` });
}

interface SignedLink {
  linkId: string;
  token: string;
  cookie: { name: string; value: string };
}

function linkClient(link: SignedLink) {
  return createRouterClient(router, {
    context: {
      db,
      user: null,
      headers: cookieHeaders(link.cookie),
      linkSessions: readFieldworkLinkSessions(cookieHeaders(link.cookie)),
    } satisfies ORPCContext,
  });
}

/** `/fw/<token>/operations/contacts` 의 조립 — 페이지가 하는 그대로(관문 대신 세션 판정을 직접). */
async function fwContactsPage(link: SignedLink, searchParams: Record<string, string> = {}) {
  const session = await resolveLinkActor(link.token, cookieHeaders(link.cookie));
  if (!session.ok) throw new Error(`세션 실패: ${session.reason}`);
  return loadContactsListPage({
    surveyId,
    scope: await loadOperationsDataScope(surveyId, session.actor),
    share: resolveFieldworkShare(session.actor, surveyId),
    canViewMail: false,
    includeContactOwner: false,
    searchParams: { sort: 'resid', ...searchParams },
  });
}

/** 목록 전체(쪽 넘김 없이)의 시스템ID — 쪽 크기보다 많으면 total 로만 본다. */
async function residsOf(link: SignedLink, searchParams: Record<string, string> = {}) {
  const page = await fwContactsPage(link, searchParams);
  return { total: page.total, resids: page.rows.map((r) => r.resid) };
}

function residClause(value: string) {
  return [{ source: FILTER_SOURCE.RESID, value, op: '' as const }];
}

let surveyId = '';
let A: SignedLink;
let B: SignedLink;
let C: SignedLink;
const targetIdByResid = new Map<number, string>();

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

async function shareResidsOf(linkId: string): Promise<number[]> {
  const rows = await db
    .select({ resid: contactTargets.resid })
    .from(fieldworkLinkShares)
    .innerJoin(contactTargets, eq(contactTargets.id, fieldworkLinkShares.contactTargetId))
    .where(eq(fieldworkLinkShares.linkId, linkId))
    .orderBy(contactTargets.resid);
  return rows.map((r) => r.resid);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** 기본 나누기 — A 1–100, B 101–200. C 는 나누지 않는다. */
async function splitAB() {
  await owner.contacts.fieldworkShares.apply({ surveyId, linkId: A.linkId, clauses: residClause('1-100') });
  await owner.contacts.fieldworkShares.apply({ surveyId, linkId: B.linkId, clauses: residClause('101-200') });
}

run('담당 범위 첫 줄기 (real DB)', () => {
  beforeAll(async () => {
    await db.insert(users).values([
      { ...internalUser(OWNER_ID, '연구원'), emailVerified: true },
      { ...internalUser(PARTICIPANT_ID, '사내 실사원'), emailVerified: true },
    ]);
    await db.insert(teams).values([
      { id: TEAM_ID, name: `범위팀-${TEAM_ID.slice(0, 8)}` },
      { id: PARTICIPANT_TEAM_ID, name: `실사팀-${PARTICIPANT_TEAM_ID.slice(0, 8)}` },
    ]);
    await db.insert(teamMembers).values([
      { teamId: TEAM_ID, userId: OWNER_ID, role: 'leader' },
      { teamId: PARTICIPANT_TEAM_ID, userId: PARTICIPANT_ID, role: 'member' },
    ]);
    surveyId = crypto.randomUUID();
    await db.insert(surveys).values({
      id: surveyId,
      title: '담당 범위 조사',
      teamId: TEAM_ID,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
      contactColumns: SCHEME,
      testContactColumns: SCHEME,
    });
    await db.insert(surveyParticipants).values({
      surveyId,
      userId: PARTICIPANT_ID,
      kind: 'member',
      accessLevel: 'full',
      addedBy: OWNER_ID,
    });
    // 1–100 은 서울·인천, 101–200 은 부산·대구. 번호는 숫자인데 7 과 150 만 글자다.
    const rows = range(1, 200).map((resid) => ({
      surveyId,
      resid,
      isTest: false,
      inviteCode: `sh${crypto.randomUUID().slice(0, 12)}`,
      attrs: {
        지역: resid <= 100 ? (resid % 2 === 0 ? '서울' : '인천') : resid % 2 === 0 ? '부산' : '대구',
        번호: resid === 7 ? '칠' : resid === 150 ? '백오십' : String(resid),
      },
    }));
    const inserted = await db
      .insert(contactTargets)
      .values(rows)
      .returning({ id: contactTargets.id, resid: contactTargets.resid });
    for (const r of inserted) targetIdByResid.set(r.resid, r.id);
    // 테스트 파티션의 1번 — 범위는 실데이터에만 선다(외부 주체는 늘 실데이터).
    await db.insert(contactTargets).values({
      surveyId,
      resid: 1,
      isTest: true,
      inviteCode: `sht${crypto.randomUUID().slice(0, 12)}`,
      attrs: { 지역: '서울', 번호: '1' },
    });

    A = await issueAndSignIn('프롬');
    B = await issueAndSignIn('프라임');
    C = await issueAndSignIn('세번째');
  });

  beforeEach(async () => {
    // 매 시험을 「아무도 나누지 않은」 상태에서 시작한다.
    for (const link of [A, B, C]) {
      await owner.contacts.fieldworkShares.clear({ surveyId, linkId: link.linkId });
    }
  });

  afterAll(async () => {
    if (surveyId) {
      await db.delete(fieldworkLinkShares).where(
        inArray(
          fieldworkLinkShares.linkId,
          [A, B, C].filter(Boolean).map((l) => l.linkId),
        ),
      );
      await db.delete(surveys).where(eq(surveys.id, surveyId));
    }
    await db.delete(teamMembers).where(inArray(teamMembers.userId, [OWNER_ID, PARTICIPANT_ID]));
    await db.delete(teams).where(inArray(teams.id, [TEAM_ID, PARTICIPANT_TEAM_ID]));
    await db.delete(users).where(inArray(users.id, [OWNER_ID, PARTICIPANT_ID]));
  });

  describe('나누기 — 미리보기와 적용', () => {
    it('미리보기의 인원이 적용 결과와 같고, 적용 뒤 범위가 조건 결과와 정확히 같다', async () => {
      const preview = await owner.contacts.fieldworkShares.preview({
        surveyId,
        linkId: A.linkId,
        clauses: residClause('1-100'),
      });
      const applied = await owner.contacts.fieldworkShares.apply({
        surveyId,
        linkId: A.linkId,
        clauses: residClause('1-100'),
      });
      expect(preview).toEqual(applied);
      expect(applied.matched).toBe(100);
      expect(applied.incoming).toBe(100);
      // 테스트 파티션의 1번은 들어오지 않는다.
      expect(await shareResidsOf(A.linkId)).toEqual(range(1, 100));

      // 미리보기의 오른쪽 대상 목록도 같은 사람이다(첫 쪽, 시스템ID 순).
      const matches = await owner.contacts.fieldworkShares.matches({
        surveyId,
        linkId: A.linkId,
        clauses: residClause('1-100'),
        page: 1,
      });
      expect(matches.total).toBe(100);
      expect(matches.rows.map((r) => r.resid)).toEqual(range(1, 10));
      expect(matches.rows[0]?.links).toEqual(['프롬']);
    });

    it('조건 밖 기존 대상은 그 링크에서 빠지고, 다른 링크의 범위는 가져온 대상 말고는 그대로다', async () => {
      await splitAB();
      const summary = await owner.contacts.fieldworkShares.apply({
        surveyId,
        linkId: A.linkId,
        clauses: residClause('51-150'),
      });
      expect(summary).toMatchObject({ matched: 100, current: 100, incoming: 0, leaving: 50 });
      expect(summary.fromOthers).toEqual([{ linkId: B.linkId, name: '프라임', count: 50 }]);
      expect(await shareResidsOf(A.linkId)).toEqual(range(51, 150));
      expect(await shareResidsOf(B.linkId)).toEqual(range(151, 200));
      expect(await shareResidsOf(C.linkId)).toEqual([]);
    });

    it('같은 적용을 두 번 해도 결과가 같다 — 결과 상태 지정', async () => {
      await owner.contacts.fieldworkShares.apply({ surveyId, linkId: A.linkId, clauses: residClause('1-30') });
      const again = await owner.contacts.fieldworkShares.apply({
        surveyId,
        linkId: A.linkId,
        clauses: residClause('1-30'),
      });
      expect(again).toMatchObject({ matched: 30, current: 30, incoming: 0, leaving: 0 });
      expect(await shareResidsOf(A.linkId)).toEqual(range(1, 30));
    });

    it('해석되지 않는 조건(지워진 열·읽지 못한 ID 목록)은 거부하고 범위를 바꾸지 않는다', async () => {
      await splitAB();
      for (const clauses of [
        [{ source: 'attrs.지워진열', value: '서울', op: '' as const }],
        residClause(`list:${crypto.randomUUID()}:3`),
      ]) {
        await expect(
          owner.contacts.fieldworkShares.preview({ surveyId, linkId: A.linkId, clauses }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(
          owner.contacts.fieldworkShares.apply({ surveyId, linkId: A.linkId, clauses }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
      expect(await shareResidsOf(A.linkId)).toEqual(range(1, 100));
    });

    it('남의 설문·종료된 링크·클라이언트 링크 id 는 NOT_FOUND 이고 아무것도 쓰지 않는다', async () => {
      const { link: client } = await owner.workspace.accessLinks.issue({ surveyId, kind: 'client' });
      const closed = await issueAndSignIn('닫힌 링크');
      await owner.workspace.accessLinks.close({ surveyId, linkId: closed.linkId });
      for (const linkId of [client.id, closed.linkId, crypto.randomUUID()]) {
        await expect(
          owner.contacts.fieldworkShares.apply({ surveyId, linkId, clauses: residClause('1-10') }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(
          owner.contacts.fieldworkShares.clear({ surveyId, linkId }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
      const touched = await db
        .select({ id: surveyAccessLinks.id })
        .from(surveyAccessLinks)
        .where(and(inArray(surveyAccessLinks.id, [client.id, closed.linkId])));
      expect(touched).toHaveLength(2);
      expect(await shareResidsOf(closed.linkId)).toEqual([]);
      await owner.workspace.accessLinks.close({ surveyId, linkId: client.id });
    });

    it('범위 목록이 링크별 이름·인원·나눔 여부를 보인다', async () => {
      await splitAB();
      await owner.contacts.fieldworkShares.apply({ surveyId, linkId: B.linkId, clauses: residClause('101-120') });
      const { links } = await owner.contacts.fieldworkShares.list({ surveyId });
      expect(links.map((l) => [l.name, l.divided, l.count])).toEqual([
        ['프롬', true, 100],
        ['프라임', true, 20],
        ['세번째', false, 0],
      ]);
      // 공유 설정 링크 카드의 요약도 같은 값이다(「나눔 · N명」 / 「설문 전체」).
      const cards = await owner.workspace.accessLinks.list({ surveyId, kind: 'fieldwork' });
      expect(cards.links.map((l) => l.share)).toEqual([
        { divided: true, count: 100 },
        { divided: true, count: 20 },
        { divided: false, count: 0 },
      ]);
      const clients = await owner.workspace.accessLinks.list({ surveyId, kind: 'client' });
      expect(clients.links.every((l) => l.share === null)).toBe(true);
    });
  });

  describe('외주가 보는 것 — 자기 범위만', () => {
    it('조사 대상 목록이 각자 자기 범위만 담고, 나누지 않은 링크 C 는 전체를 본다', async () => {
      await splitAB();
      const [a, b, c] = await Promise.all([residsOf(A), residsOf(B), residsOf(C)]);
      expect(a.total).toBe(100);
      expect(a.resids[0]).toBe(1);
      expect(b.total).toBe(100);
      expect(b.resids[0]).toBe(101);
      expect(c.total).toBe(200);
    });

    it('검색바 범위 검색과 ID 목록 검색이 자기 범위 안에서만 걸린다', async () => {
      await splitAB();
      expect((await residsOf(A, { col: FILTER_SOURCE.RESID, q: '90-110' })).resids).toEqual(range(90, 100));
      expect((await residsOf(B, { col: FILTER_SOURCE.RESID, q: '90-110' })).resids).toEqual(range(101, 110));

      // 2,000개를 넘는 붙여넣기가 타는 저장 목록 경로 — 외주가 직접 만든 목록이다.
      const list = await linkClient(A).contacts.idLists.create({ surveyId, ids: [50, 150] });
      const token = `list:${list.id}:${list.count}`;
      expect((await residsOf(A, { col: FILTER_SOURCE.RESID, q: token })).resids).toEqual([50]);
      expect((await residsOf(B, { col: FILTER_SOURCE.RESID, q: token })).resids).toEqual([150]);
      expect((await residsOf(C, { col: FILTER_SOURCE.RESID, q: token })).resids).toEqual([50, 150]);
    });

    it('열 머리 값 목록(attrs 값·숫자가 아닌 값 수)이 자기 범위의 값만 담는다', async () => {
      await splitAB();
      const valuesOf = (link: SignedLink, attrsKey: string) =>
        linkClient(link).contacts.attrValues.list({ surveyId, attrsKey });
      const nonNumericOf = (link: SignedLink) =>
        linkClient(link).contacts.attrValues.nonNumericCount({ surveyId, attrsKey: '번호' });

      expect((await valuesOf(A, '지역')).values).toEqual(['서울', '인천']);
      expect((await valuesOf(B, '지역')).values).toEqual(['대구', '부산']);
      expect((await valuesOf(C, '지역')).values).toEqual(['대구', '부산', '서울', '인천']);
      expect(await nonNumericOf(A)).toEqual({ count: 1 });
      expect(await nonNumericOf(B)).toEqual({ count: 1 });
      expect(await nonNumericOf(C)).toEqual({ count: 2 });
    });

    it('범위를 바꾸면 같은 링크 세션의 다음 요청에 반영된다 — 다시 접속하지 않는다', async () => {
      expect((await residsOf(A)).total).toBe(200);
      await owner.contacts.fieldworkShares.apply({ surveyId, linkId: A.linkId, clauses: residClause('1-10') });
      expect((await residsOf(A)).resids).toEqual(range(1, 10));
      expect((await linkClient(A).contacts.attrValues.list({ surveyId, attrsKey: '지역' })).values).toEqual([
        '서울',
        '인천',
      ]);
    });

    it('범위를 모두 빼앗긴 링크는 0명을 보고, 범위 없애기 뒤에는 다시 전체를 본다', async () => {
      await splitAB();
      await owner.contacts.fieldworkShares.apply({ surveyId, linkId: B.linkId, clauses: residClause('1-200') });
      expect(await shareResidsOf(A.linkId)).toEqual([]);
      const robbed = await residsOf(A);
      expect(robbed.total).toBe(0);
      expect((await linkClient(A).contacts.attrValues.list({ surveyId, attrsKey: '지역' })).values).toEqual([]);
      expect(await linkClient(A).contacts.attrValues.nonNumericCount({ surveyId, attrsKey: '번호' })).toEqual({
        count: 0,
      });

      const cleared = await owner.contacts.fieldworkShares.clear({ surveyId, linkId: A.linkId });
      expect(cleared).toEqual({ released: 0 });
      expect((await residsOf(A)).total).toBe(200);
    });

    it('조건 결과가 0명이어도 나눈 링크는 0명을 본다', async () => {
      const summary = await owner.contacts.fieldworkShares.apply({
        surveyId,
        linkId: A.linkId,
        clauses: residClause('9000'),
      });
      expect(summary.matched).toBe(0);
      expect((await residsOf(A)).total).toBe(0);
    });

    it('외주 콘솔 목록에 컨택원 열·후보·선택지·값이 여전히 없다', async () => {
      await splitAB();
      const assignment = await createAssignment({ surveyId, name: '1차' });
      await applyAssignment({ surveyId, assignmentId: assignment.id, clauses: residClause('1-200') });
      const page = await fwContactsPage(A);
      expect(page.columnCandidates.some((c) => c.source === FILTER_SOURCE.CONTACT_OWNER)).toBe(false);
      expect(page.assignmentOptions).toEqual([]);
      expect(page.rows.every((r) => r.assignment === null)).toBe(true);
    });
  });

  describe('컨택원과 다른 층이다', () => {
    it('컨택원을 교체 적용해도 담당 범위가 바뀌지 않는다', async () => {
      await splitAB();
      const assignment = await createAssignment({ surveyId, name: '재통화 대상' });
      await applyAssignment({ surveyId, assignmentId: assignment.id, clauses: residClause('1-200') });
      await applyAssignment({ surveyId, assignmentId: assignment.id, clauses: residClause('150-160') });
      expect(await shareResidsOf(A.linkId)).toEqual(range(1, 100));
      expect(await shareResidsOf(B.linkId)).toEqual(range(101, 200));
    });
  });

  describe('권한 — 나누는 사람은 링크를 발급할 수 있는 사람이다', () => {
    it('컨택원 관리만 가진 사내 실사원은 나누기 표면 전부에서 거부된다', async () => {
      // 전제: 이 계정은 컨택원은 나눌 수 있고 링크는 발급할 수 없다.
      const { capabilities } = await loadSurveyAccess(internalUser(PARTICIPANT_ID, '사내 실사원'), surveyId);
      expect(capabilities.has('contacts.manage')).toBe(true);
      expect(capabilities.has('survey.manageAccess')).toBe(false);
      const calls = [
        () => participant.contacts.fieldworkShares.list({ surveyId }),
        () =>
          participant.contacts.fieldworkShares.preview({ surveyId, linkId: A.linkId, clauses: residClause('1') }),
        () =>
          participant.contacts.fieldworkShares.apply({ surveyId, linkId: A.linkId, clauses: residClause('1') }),
        () => participant.contacts.fieldworkShares.clear({ surveyId, linkId: A.linkId }),
        () =>
          participant.contacts.fieldworkShares.matches({
            surveyId,
            linkId: A.linkId,
            clauses: residClause('1'),
            page: 1,
          }),
        () => participant.contacts.fieldworkShares.facets({ surveyId, source: 'attrs.지역' }),
      ];
      for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await shareResidsOf(A.linkId)).toEqual([]);
    });

    it('링크 주체는 베이스에서 거부된다 — 자기 링크의 범위도 못 넓힌다', async () => {
      await splitAB();
      await expect(
        linkClient(A).contacts.fieldworkShares.apply({ surveyId, linkId: A.linkId, clauses: residClause('1-200') }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(
        linkClient(A).contacts.fieldworkShares.clear({ surveyId, linkId: A.linkId }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(await shareResidsOf(A.linkId)).toEqual(range(1, 100));
    });
  });

  describe('대상 쪽 무결성', () => {
    it('대상이 지워지면 범위 행도 사라진다 — 나눈 링크는 0명으로 남는다', async () => {
      await owner.contacts.fieldworkShares.apply({ surveyId, linkId: A.linkId, clauses: residClause('200') });
      const id = targetIdByResid.get(200)!;
      await db.delete(contactTargets).where(eq(contactTargets.id, id));
      expect(await shareResidsOf(A.linkId)).toEqual([]);
      expect((await residsOf(A)).total).toBe(0);
      // 다음 시험을 위해 되살린다.
      const [restored] = await db
        .insert(contactTargets)
        .values({
          surveyId,
          resid: 200,
          isTest: false,
          inviteCode: `sh${crypto.randomUUID().slice(0, 12)}`,
          attrs: { 지역: '부산', 번호: '200' },
        })
        .returning({ id: contactTargets.id });
      targetIdByResid.set(200, restored!.id);
    });
  });
});
