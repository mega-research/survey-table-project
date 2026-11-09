/**
 * 담당 범위가 풀리는 경우 — 링크 종료와 명단 교체 업로드 (fieldwork-multi-company 티켓 09, ADR-0035).
 *
 * 시험마다 새 설문을 만든다 — 링크 종료·교체 업로드는 되돌릴 수 없는 동작이라 시험끼리 상태를 나누지
 * 않는다. 설문 하나에 조사 대상 1–200(실데이터), 외주 링크 A(프롬)·B(프라임)·C(나누지 않음).
 *
 * 실 DB 인 이유: 범위가 풀리는 것은 FK CASCADE·같은 트랜잭션의 DELETE 이고, 외주가 보는 0명/전체는
 * WHERE 의 서브쿼리다. 목으로는 둘 다 보이지 않는다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { createRouterClient } from '@orpc/server';
import ExcelJS from 'exceljs';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactAttempts,
  contactTargetEditLogs,
  contactTargets,
  fieldworkLinkShares,
  surveyAccessLinks,
  surveys,
  teamMembers,
  teams,
  users,
} from '@/db/schema';
import { readFieldworkLinkSessions } from '@/lib/auth/access-link-session';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { authenticateAccessLink, resolveLinkActor } from '@/server/access-link';
import { ingestContactUpload } from '@/server/contacts/services/contact-uploads';
import { countFieldworkSharesToRelease } from '@/server/contacts/services/fieldwork-share-release';
import type { ORPCContext } from '@/server/context';
import { loadOperationsDataScope } from '@/server/data-scope';
import { resolveFieldworkShare } from '@/server/fieldwork-share';
import { loadContactsListPage } from '@/server/read-models/contacts-list-page';
import { router } from '@/server/router';
import type { ContactColumnScheme, ContactUploadMapping } from '@/shared/contracts/contacts';

// 요청 밖이라 「테스트 데이터 보기」 쿠키가 없다 — 연구원 화면은 실데이터를 본다(server/data-scope).
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: async () => ({ get: () => undefined }),
}));
// 업로드 서비스가 세션 없이 부르는 외부 주체 판정 — 연구원(내부)으로 고정한다(contact-upload-modes 와 같다).
vi.mock('@/lib/auth/external-viewer', () => ({
  isExternalViewer: () => Promise.resolve(false),
}));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

const OWNER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();

const SCHEME: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: '번호', label: '번호', source: 'attrs.번호', order: 2 },
  ],
};

const ownerUser = {
  id: OWNER_ID,
  email: `release-${OWNER_ID}@example.com`,
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

interface Fixture {
  surveyId: string;
  A: SignedLink;
  B: SignedLink;
  C: SignedLink;
  targetIdByResid: Map<number, string>;
}

const createdSurveyIds: string[] = [];

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

/** `/fw/<token>/operations/contacts` 의 조립 — 페이지가 하는 그대로. 쪽 크기를 넘으면 total 로 본다. */
async function fwContacts(f: Fixture, link: SignedLink) {
  const session = await resolveLinkActor(link.token, cookieHeaders(link.cookie));
  if (!session.ok) throw new Error(`세션 실패: ${session.reason}`);
  const page = await loadContactsListPage({
    surveyId: f.surveyId,
    scope: await loadOperationsDataScope(f.surveyId, session.actor),
    share: resolveFieldworkShare(session.actor, f.surveyId),
    canViewMail: false,
    includeContactOwner: false,
    searchParams: { sort: 'resid' },
  });
  return { total: page.total, resids: page.rows.map((r) => r.resid) };
}

function residClause(value: string) {
  return [{ source: FILTER_SOURCE.RESID, value, op: '' as const }];
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
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

async function makeXlsx(headers: string[], rows: string[][]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return new File([buf], 'roster.xlsx');
}

function uploadMapping(overrides: Partial<ContactUploadMapping> = {}): ContactUploadMapping {
  return {
    systemFields: {},
    selectedAttrsKeys: ['번호'],
    headerRow: 1,
    sheetName: 'Sheet1',
    ...overrides,
  };
}

/** 번호 from–to 로 명단 파일을 만든다. */
function rosterFile(from: number, to: number): Promise<File> {
  return makeXlsx(
    ['번호'],
    range(from, to).map((n) => [String(n)]),
  );
}

async function setup(): Promise<Fixture> {
  const surveyId = crypto.randomUUID();
  createdSurveyIds.push(surveyId);
  await db.insert(surveys).values({
    id: surveyId,
    title: '범위 해제 조사',
    teamId: TEAM_ID,
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: OWNER_ID,
    createdBy: OWNER_ID,
    contactColumns: SCHEME,
    testContactColumns: SCHEME,
  });
  const inserted = await db
    .insert(contactTargets)
    .values(
      range(1, 200).map((resid) => ({
        surveyId,
        resid,
        isTest: false,
        inviteCode: `rl${crypto.randomUUID().slice(0, 12)}`,
        attrs: { 번호: String(resid) },
      })),
    )
    .returning({ id: contactTargets.id, resid: contactTargets.resid });
  const targetIdByResid = new Map(inserted.map((r) => [r.resid, r.id]));

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
  const A = await issueAndSignIn('프롬');
  const B = await issueAndSignIn('프라임');
  const C = await issueAndSignIn('나누지않음');
  return { surveyId, A, B, C, targetIdByResid };
}

/** A 1–100, B 101–200. C 는 나누지 않는다. */
async function splitAB(f: Fixture) {
  await owner.contacts.fieldworkShares.apply({
    surveyId: f.surveyId,
    linkId: f.A.linkId,
    clauses: residClause('1-100'),
  });
  await owner.contacts.fieldworkShares.apply({
    surveyId: f.surveyId,
    linkId: f.B.linkId,
    clauses: residClause('101-200'),
  });
}

function close(f: Fixture, link: SignedLink) {
  return owner.workspace.accessLinks.close({ surveyId: f.surveyId, linkId: link.linkId });
}

run('담당 범위가 풀리는 경우 (real DB)', () => {
  beforeAll(async () => {
    await db.insert(users).values({ ...ownerUser, emailVerified: true });
    await db.insert(teams).values({ id: TEAM_ID, name: `해제팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembers).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'leader' });
  });

  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      const links = await db
        .select({ id: surveyAccessLinks.id })
        .from(surveyAccessLinks)
        .where(inArray(surveyAccessLinks.surveyId, createdSurveyIds));
      if (links.length > 0) {
        await db.delete(fieldworkLinkShares).where(
          inArray(
            fieldworkLinkShares.linkId,
            links.map((l) => l.id),
          ),
        );
        await db.delete(contactAttempts).where(
          inArray(
            contactAttempts.fieldworkLinkId,
            links.map((l) => l.id),
          ),
        );
      }
      await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
    }
    await db.delete(teamMembers).where(eq(teamMembers.userId, OWNER_ID));
    await db.delete(teams).where(eq(teams.id, TEAM_ID));
    await db.delete(users).where(eq(users.id, OWNER_ID));
  });

  describe('링크 종료', () => {
    it('종료하면 그 링크의 범위 행이 없고, 회차·수정 기록의 링크 귀속은 그대로다 — 다른 링크 범위도 그대로', async () => {
      const f = await setup();
      await splitAB(f);
      const target = f.targetIdByResid.get(5)!;
      await linkClient(f.A).contacts.attempts.add({
        surveyId: f.surveyId,
        contactTargetId: target,
        resultCode: '부재중',
      });
      await linkClient(f.A).contacts.targets.setMemo({
        surveyId: f.surveyId,
        id: target,
        memo: '저녁 재시도',
        contactMethod: 'visit',
      });

      await close(f, f.A);

      expect(await shareResidsOf(f.A.linkId)).toEqual([]);
      expect(await shareResidsOf(f.B.linkId)).toEqual(range(101, 200));
      const attempts = await db
        .select({ linkId: contactAttempts.fieldworkLinkId })
        .from(contactAttempts)
        .where(eq(contactAttempts.contactTargetId, target));
      expect(attempts).toEqual([{ linkId: f.A.linkId }]);
      const edits = await db
        .select({ editedBy: contactTargetEditLogs.editedBy })
        .from(contactTargetEditLogs)
        .where(eq(contactTargetEditLogs.contactTargetId, target));
      expect(edits).toEqual([{ editedBy: `link:${f.A.linkId}` }]);
    });

    it('종료된 링크의 옛 대상을 다른 링크에 적용할 때 겹침으로 묻지 않는다 — 어느 링크에도 없던 대상으로 센다', async () => {
      const f = await setup();
      await splitAB(f);
      await close(f, f.A);

      const preview = await owner.contacts.fieldworkShares.preview({
        surveyId: f.surveyId,
        linkId: f.B.linkId,
        clauses: residClause('1-150'),
      });
      expect(preview).toMatchObject({ matched: 150, current: 100, incoming: 100, leaving: 50, fromOthers: [] });

      await owner.contacts.fieldworkShares.apply({
        surveyId: f.surveyId,
        linkId: f.B.linkId,
        clauses: residClause('1-150'),
      });
      expect(await shareResidsOf(f.B.linkId)).toEqual(range(1, 150));
    });

    it('종료 확인 창의 재료 — 링크 목록이 링크별 풀릴 인원을 싣고, 종료 뒤 그 링크는 목록에서 빠진다', async () => {
      const f = await setup();
      await splitAB(f);
      const before = await owner.workspace.accessLinks.list({ surveyId: f.surveyId, kind: 'fieldwork' });
      expect(before.links.map((l) => [l.id, l.share])).toEqual([
        [f.A.linkId, { divided: true, count: 100 }],
        [f.B.linkId, { divided: true, count: 100 }],
        [f.C.linkId, { divided: false, count: 0 }],
      ]);

      await close(f, f.A);
      const after = await owner.workspace.accessLinks.list({ surveyId: f.surveyId, kind: 'fieldwork' });
      expect(after.links.map((l) => l.id)).toEqual([f.B.linkId, f.C.linkId]);
    });

    it('종료된 링크는 다시 종료할 수 없고 아무것도 바꾸지 않는다', async () => {
      const f = await setup();
      await splitAB(f);
      await close(f, f.A);
      await expect(close(f, f.A)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await shareResidsOf(f.B.linkId)).toEqual(range(101, 200));
    });
  });

  describe('명단 교체 업로드', () => {
    it('교체 업로드 경고의 재료 — 나눈 열린 링크마다 이름과 풀릴 인원, 나누지 않은 링크·종료된 링크는 없다', async () => {
      const f = await setup();
      await splitAB(f);
      expect(await countFieldworkSharesToRelease(f.surveyId)).toEqual([
        { linkId: f.A.linkId, name: '프롬', count: 100 },
        { linkId: f.B.linkId, name: '프라임', count: 100 },
      ]);
      await close(f, f.A);
      expect(await countFieldworkSharesToRelease(f.surveyId)).toEqual([
        { linkId: f.B.linkId, name: '프라임', count: 100 },
      ]);
    });

    it('교체 업로드 뒤 나눈 링크는 0명을 보고(넓어지지 않는다), 나누지 않은 링크는 새 명단 전체를 본다', async () => {
      const f = await setup();
      await splitAB(f);
      await ingestContactUpload({ surveyId: f.surveyId, file: await rosterFile(1, 150), mapping: uploadMapping() });

      expect(await shareResidsOf(f.A.linkId)).toEqual([]);
      expect(await shareResidsOf(f.B.linkId)).toEqual([]);
      expect((await fwContacts(f, f.A)).total).toBe(0);
      expect((await fwContacts(f, f.B)).total).toBe(0);
      expect((await fwContacts(f, f.C)).total).toBe(150);
      expect(await countFieldworkSharesToRelease(f.surveyId)).toEqual([]);

      // 다시 나누면 새 명단 기준으로 선다.
      await owner.contacts.fieldworkShares.apply({
        surveyId: f.surveyId,
        linkId: f.A.linkId,
        clauses: residClause('1-10'),
      });
      expect((await fwContacts(f, f.A)).total).toBe(10);
    });

    it('추가 업로드로 들어온 대상은 나눈 링크의 목록에 나타나지 않는다 — 나누지 않은 링크에만 보인다', async () => {
      const f = await setup();
      await splitAB(f);
      await ingestContactUpload({
        surveyId: f.surveyId,
        file: await rosterFile(201, 230),
        mapping: uploadMapping({ mode: 'append' }),
      });

      const a = await fwContacts(f, f.A);
      expect(a.total).toBe(100);
      expect(a.resids.every((r) => r <= 100)).toBe(true);
      expect((await fwContacts(f, f.B)).total).toBe(100);
      expect((await fwContacts(f, f.C)).total).toBe(230);
      expect(await shareResidsOf(f.A.linkId)).toEqual(range(1, 100));
    });
  });
  describe('동시성 — 같은 잠금 순서로 줄을 선다', () => {
    it('A 종료와 A 의 대상을 가져가는 B 적용이 겹쳐도 둘 다 끝나고, A 에는 아무것도 남지 않는다', async () => {
      for (let round = 0; round < 3; round++) {
        const f = await setup();
        await splitAB(f);
        const [closed, applied] = await Promise.all([
          close(f, f.A),
          owner.contacts.fieldworkShares.apply({
            surveyId: f.surveyId,
            linkId: f.B.linkId,
            clauses: residClause('1-200'),
          }),
        ]);
        expect(closed).toEqual({ success: true });
        expect(applied.matched).toBe(200);
        expect(await shareResidsOf(f.A.linkId)).toEqual([]);
        expect(await shareResidsOf(f.B.linkId)).toEqual(range(1, 200));
      }
    });

    it('종료된 링크에 뒤늦게 닿은 적용은 NOT_FOUND 이고 범위를 다시 만들지 않는다', async () => {
      const f = await setup();
      await splitAB(f);
      const [closed, applied] = await Promise.allSettled([
        close(f, f.A),
        owner.contacts.fieldworkShares.apply({
          surveyId: f.surveyId,
          linkId: f.A.linkId,
          clauses: residClause('1-50'),
        }),
      ]);
      expect(closed.status).toBe('fulfilled');
      // 적용이 먼저 커밋했으면 종료가 그 범위를 풀고, 나중이면 적용이 닫힌 링크를 못 찾는다 — 어느 쪽이든 0명.
      if (applied.status === 'rejected') expect(applied.reason).toMatchObject({ code: 'NOT_FOUND' });
      expect(await shareResidsOf(f.A.linkId)).toEqual([]);
    });

    it('교체 업로드와 A 종료가 겹쳐도 둘 다 끝나고, 범위 행이 하나도 남지 않는다', async () => {
      const f = await setup();
      await splitAB(f);
      const file = await rosterFile(1, 120);
      await Promise.all([
        close(f, f.A),
        ingestContactUpload({ surveyId: f.surveyId, file, mapping: uploadMapping() }),
      ]);
      expect(await shareResidsOf(f.A.linkId)).toEqual([]);
      expect(await shareResidsOf(f.B.linkId)).toEqual([]);
      expect((await fwContacts(f, f.B)).total).toBe(0);
      expect((await fwContacts(f, f.C)).total).toBe(120);
    });
  });
});
