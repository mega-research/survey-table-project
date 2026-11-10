/**
 * 응답 내역·상세·수정을 담당 범위로 거른다 — 실 로컬 DB (fieldwork-multi-company 티켓 06, ADR-0035).
 *
 * 한 설문에 외주 링크 A·B·C, 조사 대상 1–20 마다 완료 응답 하나, 그리고 조사 대상에 묶이지 않은 공개 링크
 * 응답 둘. 연구원이 A 에 1–10, B 에 11–20 을 나누고 C 는 한 번도 나누지 않는다. 각 링크 세션으로
 * `/fw` 응답 내역·응답 수정 화면이 부르는 조회(`listResponsesForProfiles`·`getResponseById`)와 **라우터
 * 클라이언트**의 응답 수정 저장을 부른다 — 외주가 바깥에서 보는 결과만 단언한다.
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
  contactTargets,
  fieldworkLinkShares,
  responseEditLogs,
  surveyResponses,
  surveys,
  teamMembers,
  teams,
  users,
} from '@/db/schema';
import { readFieldworkLinkSessions } from '@/lib/auth/access-link-session';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { normalizeListArgs } from '@/lib/operations/profiles-format';
import { authenticateAccessLink, resolveLinkActor } from '@/server/access-link';
import type { ORPCContext } from '@/server/context';
import { loadOperationsDataScope } from '@/server/data-scope';
import { FIELDWORK_SHARE_ALL, resolveFieldworkShare } from '@/server/fieldwork-share-scope';
import { listResponsesForProfiles } from '@/server/operations/services/profiles';
import { getResponseEditLogs } from '@/server/read-models/contacts';
import { loadFieldworkLinkNames } from '@/server/read-models/fieldwork-link-names';
import { getResponseById } from '@/server/read-models/responses';
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
const QUESTION_KEY = 'q-share-06';

const SCHEME: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [{ key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 }],
};

const ownerUser = {
  id: OWNER_ID,
  email: `share06-${OWNER_ID}@example.com`,
  name: '연구원',
  status: 'active' as const,
  isSuperadmin: false,
  userType: 'internal' as const,
};

const owner = createRouterClient(router, {
  context: { db, user: ownerUser } satisfies ORPCContext,
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

/** 링크 세션 → 페이지가 넘기는 파티션·담당 범위 (관문 대신 세션 판정을 직접). */
async function sessionOf(link: SignedLink) {
  const session = await resolveLinkActor(link.token, cookieHeaders(link.cookie));
  if (!session.ok) throw new Error(`세션 실패: ${session.reason}`);
  return {
    scope: await loadOperationsDataScope(surveyId, session.actor),
    share: resolveFieldworkShare(session.actor, surveyId),
  };
}

/** `/fw/<token>/operations/profiles` 의 목록 조회 — 한 쪽에 다 담기는 크기로. */
async function fwProfiles(link: SignedLink, extra: { status?: string } = {}) {
  const { scope, share } = await sessionOf(link);
  const args = normalizeListArgs({ sort: 'idx', dir: 'asc', ...extra });
  return listResponsesForProfiles({
    surveyId,
    scope,
    share,
    pageSize: 100,
    page: 1,
    status: args.status,
    sort: args.sort,
    dir: args.dir,
    view: args.view,
    clauses: [],
  });
}

/** `/fw/<token>/operations/profiles/<id>/edit` 의 첫 조회 — 없으면 화면이 notFound 다. */
async function fwResponse(link: SignedLink, responseId: string) {
  const { share } = await sessionOf(link);
  return getResponseById(responseId, { surveyId, includeDeleted: true, share });
}

function residClause(value: string) {
  return [{ source: FILTER_SOURCE.RESID, value, op: '' as const }];
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

let surveyId = '';
let A: SignedLink;
let B: SignedLink;
let C: SignedLink;
const responseIdByResid = new Map<number, string>();
const publicResponseIds: string[] = [];

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

/** 기본 나누기 — A 1–10, B 11–20. C 는 나누지 않는다. */
async function splitAB() {
  await owner.contacts.fieldworkShares.apply({ surveyId, linkId: A.linkId, clauses: residClause('1-10'), overlap: 'take' });
  await owner.contacts.fieldworkShares.apply({ surveyId, linkId: B.linkId, clauses: residClause('11-20'), overlap: 'take' });
}

async function answerOf(responseId: string): Promise<unknown> {
  const [row] = await db
    .select({ questionResponses: surveyResponses.questionResponses })
    .from(surveyResponses)
    .where(eq(surveyResponses.id, responseId));
  return (row?.questionResponses as Record<string, unknown> | undefined)?.[QUESTION_KEY];
}

function editInput(responseId: string, value: string) {
  return { surveyId, responseId, questionResponses: { [QUESTION_KEY]: value }, versionId: null };
}

run('응답 내역·상세·수정의 담당 범위 (real DB)', () => {
  beforeAll(async () => {
    await db.insert(users).values({ ...ownerUser, emailVerified: true });
    await db.insert(teams).values({ id: TEAM_ID, name: `응답범위팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembers).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'leader' });
    surveyId = crypto.randomUUID();
    await db.insert(surveys).values({
      id: surveyId,
      title: '응답 담당 범위 조사',
      teamId: TEAM_ID,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
      contactColumns: SCHEME,
      testContactColumns: SCHEME,
    });
    const targets = await db
      .insert(contactTargets)
      .values(
        range(1, 20).map((resid) => ({
          surveyId,
          resid,
          isTest: false,
          inviteCode: `r6${crypto.randomUUID().slice(0, 12)}`,
          attrs: {},
        })),
      )
      .returning({ id: contactTargets.id, resid: contactTargets.resid });
    // 접수 순번은 시작 시각 순 — 대상 응답 1–20 을 먼저, 공개 응답 둘을 맨 뒤에 둔다.
    const base = Date.UTC(2026, 10, 1);
    const sorted = [...targets].sort((a, b) => a.resid - b.resid);
    for (const t of sorted) {
      const id = crypto.randomUUID();
      responseIdByResid.set(t.resid, id);
      await db.insert(surveyResponses).values({
        id,
        surveyId,
        contactTargetId: t.id,
        questionResponses: { [QUESTION_KEY]: `원래-${t.resid}` },
        sessionId: `s6-${id.slice(0, 8)}`,
        isCompleted: true,
        status: 'completed',
        startedAt: new Date(base + t.resid * 60_000),
        completedAt: new Date(base + t.resid * 60_000 + 30_000),
      });
    }
    for (const n of [1, 2]) {
      const id = crypto.randomUUID();
      publicResponseIds.push(id);
      await db.insert(surveyResponses).values({
        id,
        surveyId,
        contactTargetId: null,
        questionResponses: { [QUESTION_KEY]: `공개-${n}` },
        sessionId: `s6p-${id.slice(0, 8)}`,
        isCompleted: true,
        status: 'completed',
        startedAt: new Date(base + (100 + n) * 60_000),
        completedAt: new Date(base + (100 + n) * 60_000 + 30_000),
      });
    }

    A = await issueAndSignIn('프롬');
    B = await issueAndSignIn('프라임');
    C = await issueAndSignIn('세번째');
  });

  beforeEach(async () => {
    for (const link of [A, B, C]) {
      await owner.contacts.fieldworkShares.clear({ surveyId, linkId: link.linkId });
    }
  });

  afterAll(async () => {
    if (surveyId) {
      await db.delete(responseEditLogs).where(eq(responseEditLogs.surveyId, surveyId));
      await db.delete(fieldworkLinkShares).where(
        inArray(
          fieldworkLinkShares.linkId,
          [A, B, C].filter(Boolean).map((l) => l.linkId),
        ),
      );
      await db.delete(surveyResponses).where(eq(surveyResponses.surveyId, surveyId));
      await db.delete(surveys).where(eq(surveys.id, surveyId));
    }
    await db.delete(teamMembers).where(eq(teamMembers.userId, OWNER_ID));
    await db.delete(teams).where(eq(teams.id, TEAM_ID));
    await db.delete(users).where(eq(users.id, OWNER_ID));
  });

  describe('응답 내역', () => {
    it('나눈 링크 A 의 응답 내역에는 A 범위 대상의 응답만 있고, 공개 링크 응답은 없다', async () => {
      await splitAB();
      const page = await fwProfiles(A);
      expect(page.total).toBe(10);
      expect(page.rows.map((r) => r.resid)).toEqual(range(1, 10));
      expect(page.rows.every((r) => r.contactTargetId !== null)).toBe(true);
      const ids = new Set(page.rows.map((r) => r.id));
      for (const id of publicResponseIds) expect(ids.has(id)).toBe(false);
    });

    it('접수 순번은 자기 범위 안에서 매겨진다 — 남의 응답 수를 순번으로 드러내지 않는다', async () => {
      await splitAB();
      const page = await fwProfiles(B);
      expect(page.rows.map((r) => r.resid)).toEqual(range(11, 20));
      expect(page.rows.map((r) => Number(r.idx))).toEqual(range(1, 10));
    });

    it('상태 필터를 걸어도 자기 범위 밖으로 넓어지지 않는다', async () => {
      await splitAB();
      const page = await fwProfiles(A, { status: 'completed' });
      expect(page.total).toBe(10);
    });

    it('한 번도 나누지 않은 링크 C 는 공개 링크 응답까지 다 본다', async () => {
      await splitAB();
      const page = await fwProfiles(C);
      expect(page.total).toBe(22);
      expect(page.rows.filter((r) => r.contactTargetId === null)).toHaveLength(2);
    });

    it('업체 하나인 설문처럼 아무도 나누지 않으면 링크가 공개 응답까지 다 본다', async () => {
      const page = await fwProfiles(A);
      expect(page.total).toBe(22);
    });

    it('내부 콘솔(설문 전체)은 나눔과 무관하게 전체를 본다', async () => {
      await splitAB();
      const page = await listResponsesForProfiles({
        surveyId,
        // 연구원 화면 — 요청 밖이라 파티션은 리터럴로(실데이터).
        scope: 'real',
        share: FIELDWORK_SHARE_ALL,
        pageSize: 100,
        page: 1,
        status: 'all',
        sort: 'idx',
        dir: 'asc',
        view: 'active',
        clauses: [],
      });
      expect(page.total).toBe(22);
    });

    it('범위를 모두 빼앗긴 링크는 응답 0건을 본다', async () => {
      await owner.contacts.fieldworkShares.apply({ surveyId, linkId: A.linkId, clauses: residClause('1-10'), overlap: 'take' });
      await owner.contacts.fieldworkShares.apply({ surveyId, linkId: B.linkId, clauses: residClause('1-20'), overlap: 'take' });
      const page = await fwProfiles(A);
      expect(page.total).toBe(0);
    });
  });

  describe('응답 상세 — 수정 화면의 첫 조회', () => {
    it('B 범위 응답 id 는 A 세션에서 없음이다 — 화면이 notFound 로 접는다', async () => {
      await splitAB();
      expect(await fwResponse(A, responseIdByResid.get(15)!)).toBeUndefined();
      expect(await fwResponse(A, publicResponseIds[0]!)).toBeUndefined();
    });

    it('자기 범위 응답은 열린다', async () => {
      await splitAB();
      const row = await fwResponse(A, responseIdByResid.get(5)!);
      expect(row?.id).toBe(responseIdByResid.get(5));
    });

    it('나누지 않은 링크 C 는 공개 응답도 연다', async () => {
      await splitAB();
      const row = await fwResponse(C, publicResponseIds[0]!);
      expect(row?.id).toBe(publicResponseIds[0]);
    });
  });

  describe('응답 수정 저장 — surveyResponse.edit.saveAdminEdit', () => {
    it('B 범위 응답 id 로 A 가 저장하면 NOT_FOUND 이고 응답이 바뀌지 않는다', async () => {
      await splitAB();
      const target = responseIdByResid.get(12)!;
      await expect(
        linkClient(A).surveyResponse.edit.saveAdminEdit(editInput(target, '탈취')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await answerOf(target)).toBe('원래-12');
    });

    it('나눈 링크는 공개 링크 응답을 고칠 수 없다', async () => {
      await splitAB();
      const target = publicResponseIds[1]!;
      await expect(
        linkClient(A).surveyResponse.edit.saveAdminEdit(editInput(target, '탈취')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await answerOf(target)).toBe('공개-2');
    });

    it('자기 범위 응답은 고쳐지고, 나누지 않은 링크 C 는 공개 응답도 고친다', async () => {
      await splitAB();
      const own = responseIdByResid.get(3)!;
      await expect(
        linkClient(A).surveyResponse.edit.saveAdminEdit(editInput(own, 'A가 고침')),
      ).resolves.toEqual({ ok: true });
      expect(await answerOf(own)).toBe('A가 고침');

      const pub = publicResponseIds[0]!;
      await expect(
        linkClient(C).surveyResponse.edit.saveAdminEdit(editInput(pub, 'C가 고침')),
      ).resolves.toEqual({ ok: true });
      expect(await answerOf(pub)).toBe('C가 고침');
    });

    it('범위를 옮기면 이미 끝난 응답도 새 범위를 따라간다', async () => {
      await splitAB();
      // 6–10 을 B 로 옮긴다(가져오기) — A 는 1–5, B 는 6–20.
      await owner.contacts.fieldworkShares.apply({ surveyId, linkId: A.linkId, clauses: residClause('1-5'), overlap: 'take' });
      await owner.contacts.fieldworkShares.apply({ surveyId, linkId: B.linkId, clauses: residClause('6-20'), overlap: 'take' });

      expect((await fwProfiles(A)).rows.map((r) => r.resid)).toEqual(range(1, 5));
      expect((await fwProfiles(B)).rows.map((r) => r.resid)).toEqual(range(6, 20));

      const moved = responseIdByResid.get(8)!;
      expect(await fwResponse(A, moved)).toBeUndefined();
      await expect(
        linkClient(A).surveyResponse.edit.saveAdminEdit(editInput(moved, 'A가 고침')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        linkClient(B).surveyResponse.edit.saveAdminEdit(editInput(moved, 'B가 고침')),
      ).resolves.toEqual({ ok: true });
      expect(await answerOf(moved)).toBe('B가 고침');
    });
  });

  describe('응답 수정 이력', () => {
    it('외주가 남긴 줄은 외주 콘솔에 「외주」로만, 내부 콘솔에는 「외주 · 이름표」로 읽힌다', async () => {
      await splitAB();
      const own = responseIdByResid.get(7)!;
      await linkClient(A).surveyResponse.edit.saveAdminEdit(editInput(own, '이력 남김'));

      // 외주 콘솔 — 이름표를 넘기지 않는다(fieldwork-multi-company 티켓 02).
      const [fwRow] = await getResponseEditLogs(own, null);
      expect(fwRow).toMatchObject({ byFieldworkLink: true, editorEmail: null });

      // 내부 콘솔 — 링크 이름표를 넘긴다.
      const [internalRow] = await getResponseEditLogs(own, null, await loadFieldworkLinkNames(surveyId));
      expect(internalRow).toMatchObject({ byFieldworkLink: true, editorEmail: '외주 · 프롬' });
    });
  });
});
