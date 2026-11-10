/**
 * 담당 범위 겹침 선택과 동시 적용 — 실 로컬 DB (fieldwork-multi-company 티켓 04, ADR-0035).
 *
 * 한 설문에 외주 링크 A·B·C, 조사 대상 1–200. 연구원이 범위를 적용할 때 조건 결과 중 다른 열린 링크에
 * 이미 있는 대상(겹침)을 가져오기·남겨 두기·같이 맡기기 중 하나로 처리한다. 결과는 담당 범위 표와 각
 * 링크 세션이 보는 조사 대상 목록(`/fw` 조립)으로 본다.
 *
 * 동시성은 **잠금 순서와 잠금 세기**를 실제 PG 로 본다 — 두 링크에 같은 대상을 가져오는 적용이 줄을 서는가,
 * 적용이 쥔 대상 잠금 아래에서도 응답 행 생성(대상을 가리키는 FK 삽입)은 막히지 않는가, 교착으로 취소된
 * 적용이 조건을 새로 계산해 다시 도는가.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { createRouterClient } from '@orpc/server';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactTargets,
  fieldworkLinkShares,
  surveyResponses,
  surveys,
  teamMembers,
  teams,
  users,
} from '@/db/schema';
import { logger } from '@/lib/logger';
import { shareTargetOutcome } from '@/features/operations/contacts/shares/share-overlap';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { authenticateAccessLink, resolveLinkActor } from '@/server/access-link';
import type { ORPCContext } from '@/server/context';
import { loadOperationsDataScope } from '@/server/data-scope';
import { resolveFieldworkShare } from '@/server/fieldwork-share-scope';
import { loadContactsListPage } from '@/server/read-models/contacts-list-page';
import { router } from '@/server/router';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import type { FieldworkShareOverlap } from '@/shared/contracts/contacts-io';

import { backendPid, waitForLockWaitersBehind } from '../helpers/lock-waiters';

vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: async () => ({ get: () => undefined }),
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
    { key: '지역', label: '지역', source: 'attrs.지역', order: 2 },
  ],
};

const ownerUser = {
  id: OWNER_ID,
  email: `overlap-${OWNER_ID}@example.com`,
  name: '연구원',
  status: 'active' as const,
  isSuperadmin: false,
  userType: 'internal' as const,
};

const owner = createRouterClient(router, {
  context: { db, user: ownerUser } satisfies ORPCContext,
});

interface SignedLink {
  linkId: string;
  token: string;
  cookie: { name: string; value: string };
}

function cookieHeaders(cookie: { name: string; value: string }): Headers {
  return new Headers({ cookie: `${cookie.name}=${cookie.value}` });
}

async function fwContactsPage(link: SignedLink) {
  const session = await resolveLinkActor(link.token, cookieHeaders(link.cookie));
  if (!session.ok) throw new Error(`세션 실패: ${session.reason}`);
  return loadContactsListPage({
    surveyId,
    scope: await loadOperationsDataScope(surveyId, session.actor),
    share: resolveFieldworkShare(session.actor, surveyId),
    canViewMail: false,
    includeContactOwner: false,
    searchParams: { sort: 'resid', col: FILTER_SOURCE.RESID, q: '99-118' },
  });
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

function apply(link: SignedLink, value: string, overlap: FieldworkShareOverlap) {
  return owner.contacts.fieldworkShares.apply({
    surveyId,
    linkId: link.linkId,
    clauses: residClause(value),
    overlap,
  });
}

/** B 가 101–200 을 맡은 상태에서 A 에 51–150 을 건다 — 겹침은 101–150 의 50명. */
async function bHolds101to200() {
  await apply(B, '101-200', 'take');
}

/** 다른 트랜잭션이 잠금을 쥔 채 기다리게 한다 — 놓을 때까지 그 트랜잭션은 열려 있다. */
function holdInTransaction(
  lock: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>,
) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: (pid: number) => void;
  const pid = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const done = db.transaction(async (tx) => {
    await lock(tx);
    ready(await backendPid(tx));
    await released;
  });
  return { pid, release, done };
}

/** 정해진 시간 안에 끝나는가 — 끝나지 않으면 'timeout'. */
async function within<T>(ms: number, p: Promise<T>): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

run('담당 범위 겹침 선택과 동시 적용 (real DB)', () => {
  beforeAll(async () => {
    await db.insert(users).values({ ...ownerUser, emailVerified: true });
    await db.insert(teams).values({ id: TEAM_ID, name: `겹침팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembers).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'leader' });
    surveyId = crypto.randomUUID();
    await db.insert(surveys).values({
      id: surveyId,
      title: '겹침 조사',
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
          inviteCode: `ov${crypto.randomUUID().slice(0, 12)}`,
          attrs: { 지역: resid % 2 === 0 ? '서울' : '부산' },
        })),
      )
      .returning({ id: contactTargets.id, resid: contactTargets.resid });
    for (const r of inserted) targetIdByResid.set(r.resid, r.id);

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
      await db.delete(surveyResponses).where(eq(surveyResponses.surveyId, surveyId));
      await db.execute(sql`
        DELETE FROM fieldwork_link_shares s USING survey_access_links l
        WHERE l.id = s.link_id AND l.survey_id = ${surveyId}
      `);
      await db.delete(surveys).where(eq(surveys.id, surveyId));
    }
    await db.delete(teamMembers).where(eq(teamMembers.userId, OWNER_ID));
    await db.delete(teams).where(eq(teams.id, TEAM_ID));
    await db.delete(users).where(inArray(users.id, [OWNER_ID]));
  });

  describe('적용 SQL 은 화면의 의미론 표(shareTargetOutcome)와 같다', () => {
    // 서버 적용 SQL 은 화면이 미리 보이는 의미론 표를 손으로 옮긴 사본이다 — 둘이 갈리면 화면이 말한 것과 다른
    // 범위가 선다. 사실 셋(조건에 맞음 · 이 링크에 있음 · 다른 열린 링크에 있음)의 여덟 조합을 시스템ID 1–8 에
    // 깔고, 처리 셋마다 적용한 결과를 표가 낸 답과 대조한다.
    const facts = range(1, 8).map((resid) => {
      const bits = resid - 1;
      return {
        resid,
        matched: (bits & 4) !== 0,
        inThisLink: (bits & 2) !== 0,
        inOtherOpenLink: (bits & 1) !== 0,
      };
    });
    const matchedClause = facts
      .filter((f) => f.matched)
      .map((f) => f.resid)
      .join(', ');

    it.each(['take', 'keep', 'joint'] as const)('%s', async (overlap) => {
      const rows = facts.flatMap((f) => [
        ...(f.inThisLink ? [{ linkId: A.linkId, contactTargetId: targetIdByResid.get(f.resid)! }] : []),
        ...(f.inOtherOpenLink ? [{ linkId: B.linkId, contactTargetId: targetIdByResid.get(f.resid)! }] : []),
      ]);
      await db.insert(fieldworkLinkShares).values(rows);

      await apply(A, matchedClause, overlap);

      const inA = new Set(await shareResidsOf(A.linkId));
      const inB = new Set(await shareResidsOf(B.linkId));
      const actual = facts.map((f) => [f.resid, inA.has(f.resid), inB.has(f.resid)]);
      const expected = facts.map((f) => {
        const outcome = shareTargetOutcome(f, overlap);
        return [f.resid, outcome.inThisLink, f.inOtherOpenLink && !outcome.leavesOtherLinks];
      });
      expect(actual).toEqual(expected);
    });
  });

  describe('미리보기 — 겹치는 대상을 링크별로', () => {
    it('다른 링크에 이미 있는 대상을 링크별 인원으로 보이고, 겹침이 없으면 0이다', async () => {
      await bHolds101to200();
      const overlapping = await owner.contacts.fieldworkShares.preview({
        surveyId,
        linkId: A.linkId,
        clauses: residClause('51-150'),
      });
      expect(overlapping).toMatchObject({
        matched: 100,
        current: 0,
        incoming: 50,
        overlap: 50,
        leaving: 0,
      });
      expect(overlapping.fromOthers).toEqual([{ linkId: B.linkId, name: '프라임', count: 50 }]);

      const clean = await owner.contacts.fieldworkShares.preview({
        surveyId,
        linkId: A.linkId,
        clauses: residClause('1-100'),
      });
      expect(clean).toMatchObject({ matched: 100, incoming: 100, overlap: 0, fromOthers: [] });
    });

    it('두 링크가 같이 맡은 대상은 링크마다 세되 겹침 인원은 한 번만 센다', async () => {
      await apply(B, '101-150', 'take');
      await apply(C, '101-150', 'joint');
      const summary = await owner.contacts.fieldworkShares.preview({
        surveyId,
        linkId: A.linkId,
        clauses: residClause('101-110'),
      });
      expect(summary.overlap).toBe(10);
      expect(summary.fromOthers).toEqual([
        { linkId: B.linkId, name: '프라임', count: 10 },
        { linkId: C.linkId, name: '세번째', count: 10 },
      ]);
    });
  });

  describe('적용 — 고른 처리대로', () => {
    it('가져오기: 겹치는 대상이 그 링크에서 빠져 이쪽으로 온다', async () => {
      await bHolds101to200();
      const result = await apply(A, '51-150', 'take');
      expect(result).toMatchObject({
        overlapChoice: 'take',
        matched: 100,
        overlap: 50,
        after: 100,
      });
      expect(await shareResidsOf(A.linkId)).toEqual(range(51, 150));
      expect(await shareResidsOf(B.linkId)).toEqual(range(151, 200));
    });

    it('남겨 두기: 겹치는 대상은 원래 링크에 두고 나머지만 이쪽에 넣는다', async () => {
      await bHolds101to200();
      const result = await apply(A, '51-150', 'keep');
      expect(result).toMatchObject({ overlapChoice: 'keep', matched: 100, overlap: 50, after: 50 });
      expect(await shareResidsOf(A.linkId)).toEqual(range(51, 100));
      expect(await shareResidsOf(B.linkId)).toEqual(range(101, 200));
    });

    it('같이 맡기기: 겹치는 대상이 두 링크에 모두 있고, 두 링크의 외주 목록에 모두 보인다', async () => {
      await bHolds101to200();
      const result = await apply(A, '51-150', 'joint');
      expect(result).toMatchObject({
        overlapChoice: 'joint',
        matched: 100,
        overlap: 50,
        after: 100,
      });
      expect(await shareResidsOf(A.linkId)).toEqual(range(51, 150));
      expect(await shareResidsOf(B.linkId)).toEqual(range(101, 200));

      // 시스템ID 99–118 검색(한 쪽 20명 안) — A 는 99–118, B 는 101–118.
      const [a, b] = await Promise.all([fwContactsPage(A), fwContactsPage(B)]);
      expect(a.rows.map((r) => r.resid)).toEqual(range(99, 118));
      expect(b.rows.map((r) => r.resid)).toEqual(range(101, 118));
    });

    it('이미 같이 맡은 대상은 겹침이 아니다 — 가져오기로 다시 적용해도 양쪽에 그대로 남는다', async () => {
      await bHolds101to200();
      await apply(A, '51-150', 'joint');
      const again = await apply(A, '51-150', 'take');
      expect(again).toMatchObject({ overlap: 0, fromOthers: [], after: 100 });
      expect(await shareResidsOf(A.linkId)).toEqual(range(51, 150));
      expect(await shareResidsOf(B.linkId)).toEqual(range(101, 200));
    });

    it('어느 처리를 골라도 같은 적용을 두 번 하면 결과가 같다', async () => {
      for (const overlap of ['take', 'keep', 'joint'] as const) {
        await owner.contacts.fieldworkShares.clear({ surveyId, linkId: A.linkId });
        await bHolds101to200();
        await apply(A, '51-150', overlap);
        const first = [await shareResidsOf(A.linkId), await shareResidsOf(B.linkId)];
        await apply(A, '51-150', overlap);
        expect([await shareResidsOf(A.linkId), await shareResidsOf(B.linkId)]).toEqual(first);
      }
    });

    it('겹침 처리는 필수 입력이다 — 빠지거나 모르는 값이면 거부하고 아무것도 쓰지 않는다', async () => {
      await bHolds101to200();
      const base = { surveyId, linkId: A.linkId, clauses: residClause('51-150') };
      await expect(
        owner.contacts.fieldworkShares.apply(
          base as Parameters<typeof owner.contacts.fieldworkShares.apply>[0],
        ),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        owner.contacts.fieldworkShares.apply({
          ...base,
          overlap: 'merge' as FieldworkShareOverlap,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await shareResidsOf(A.linkId)).toEqual([]);
      expect(await shareResidsOf(B.linkId)).toEqual(range(101, 200));
    });
  });

  describe('종료된 링크는 몫이 없다', () => {
    it('종료된 링크의 대상은 겹침으로 세지 않고, 남겨 두기여도 이쪽에 들어온다', async () => {
      const closed = await issueAndSignIn('닫힐 링크');
      await apply(closed, '1-20', 'take');
      await owner.workspace.accessLinks.close({ surveyId, linkId: closed.linkId });

      const summary = await owner.contacts.fieldworkShares.preview({
        surveyId,
        linkId: A.linkId,
        clauses: residClause('1-30'),
      });
      expect(summary).toMatchObject({ matched: 30, incoming: 30, overlap: 0, fromOthers: [] });
      const result = await apply(A, '1-30', 'keep');
      expect(result.after).toBe(30);
      expect(await shareResidsOf(A.linkId)).toEqual(range(1, 30));
    });
  });

  describe('외주 콘솔에는 같이 맡음이 보이지 않는다', () => {
    it('같이 맡은 대상의 목록 행이 혼자 맡은 대상과 같은 모양이고, 상대 링크의 이름표·id 가 실리지 않는다', async () => {
      await bHolds101to200();
      await apply(A, '51-150', 'joint');
      const page = await fwContactsPage(A);
      const shared = page.rows.find((r) => r.resid === 110)!;
      const alone = page.rows.find((r) => r.resid === 99)!;
      expect(Object.keys(shared).sort()).toEqual(Object.keys(alone).sort());
      const payload = JSON.stringify(page);
      expect(payload).not.toContain('프라임');
      expect(payload).not.toContain(B.linkId);
      expect(payload).not.toContain('같이');
    });
  });

  describe('동시 적용', () => {
    it('같은 대상을 두 링크가 동시에 가져오면 줄을 서고, 그 대상은 나중에 끝난 링크 하나에만 남는다', async () => {
      await apply(C, '150', 'take');
      const x = targetIdByResid.get(150)!;
      // C 의 범위 줄을 다른 트랜잭션이 쥐고 있게 한다 — A 의 적용은 대상 잠금을 잡은 뒤 그 줄을 빼려다 선다.
      const blocker = holdInTransaction(async (tx) => {
        await tx.execute(sql`
          SELECT 1 FROM fieldwork_link_shares
          WHERE link_id = ${C.linkId} AND contact_target_id = ${x} FOR UPDATE
        `);
      });
      const holder = await blocker.pid;

      const first = apply(A, '150', 'take');
      await waitForLockWaitersBehind(holder, 1, 'A 의 적용이 C 의 범위 줄 뒤에 서지 않았습니다');
      const second = apply(B, '150', 'take');
      // B 는 A 가 쥔 대상 잠금 뒤에 선다(사슬로 둘).
      await waitForLockWaitersBehind(
        holder,
        2,
        'B 의 적용이 A 가 쥔 대상 잠금 뒤에 서지 않았습니다',
      );

      blocker.release();
      await blocker.done;
      const [a, b] = await Promise.all([first, second]);
      expect(a.after).toBe(1);
      expect(b).toMatchObject({
        overlap: 1,
        fromOthers: [{ linkId: A.linkId, name: '프롬', count: 1 }],
      });
      expect(await shareResidsOf(A.linkId)).toEqual([]);
      expect(await shareResidsOf(B.linkId)).toEqual([150]);
      expect(await shareResidsOf(C.linkId)).toEqual([]);
    }, 20_000);

    it('적용이 대상 잠금을 쥔 동안에도 그 대상의 응답 행은 만들어진다 — 대상 잠금은 키를 막지 않는다', async () => {
      await apply(C, '160', 'take');
      const x = targetIdByResid.get(160)!;
      const blocker = holdInTransaction(async (tx) => {
        await tx.execute(sql`
          SELECT 1 FROM fieldwork_link_shares
          WHERE link_id = ${C.linkId} AND contact_target_id = ${x} FOR UPDATE
        `);
      });
      const holder = await blocker.pid;
      const applying = apply(A, '160', 'take');
      await waitForLockWaitersBehind(holder, 1, 'A 의 적용이 C 의 범위 줄 뒤에 서지 않았습니다');

      // 초대 링크로 들어온 응답자의 응답 행 — contact_target_id FK 검사가 대상 행에 키 공유 잠금을 건다.
      const entered = await within(
        3_000,
        db
          .insert(surveyResponses)
          .values({
            surveyId,
            contactTargetId: x,
            sessionId: crypto.randomUUID(),
            status: 'in_progress',
            questionResponses: {},
          })
          .returning({ id: surveyResponses.id }),
      );
      const stillApplying = await within(50, applying);
      blocker.release();
      await blocker.done;
      await applying;

      expect(entered).not.toBe('timeout');
      expect(stillApplying).toBe('timeout');
      expect(await shareResidsOf(A.linkId)).toEqual([160]);
    }, 20_000);

    it('교착으로 취소된 적용은 처음부터 다시 돌고, 조건도 그 사이 바뀐 명단으로 새로 계산한다', async () => {
      // 조건 = 지역 서울(짝수 100명). 잠금은 id 순이라 가장 작은 id 와 가장 큰 id 를 고른다.
      const seoulIds = range(1, 200)
        .filter((r) => r % 2 === 0)
        .map((r) => targetIdByResid.get(r)!)
        .sort();
      const low = seoulIds[0]!;
      const high = seoulIds[seoulIds.length - 1]!;
      const warn = vi.spyOn(logger, 'warn');
      try {
        let goOn!: () => void;
        const proceed = new Promise<void>((resolve) => {
          goOn = resolve;
        });
        let ready!: (pid: number) => void;
        const otherPid = new Promise<number>((resolve) => {
          ready = resolve;
        });
        const other = db.transaction(async (tx) => {
          // 교착 판정은 먼저 기다리기 시작한 적용 쪽에서 나게 한다(이쪽은 늦게 판정).
          await tx.execute(sql`SET LOCAL deadlock_timeout = '10s'`);
          await tx.execute(sql`SELECT id FROM contact_targets WHERE id = ${high} FOR UPDATE`);
          ready(await backendPid(tx));
          await proceed;
          // 적용이 low 를 쥔 채 high 를 기다리는 동안 low 의 지역을 바꾼다 → 교착.
          await tx.execute(sql`
            UPDATE contact_targets SET attrs = jsonb_set(attrs, '{지역}', '"부산"') WHERE id = ${low}
          `);
        });
        const holder = await otherPid;
        const applying = owner.contacts.fieldworkShares.apply({
          surveyId,
          linkId: A.linkId,
          clauses: [{ source: 'attrs.지역', value: '서울', op: '' }],
          overlap: 'take',
        });
        await waitForLockWaitersBehind(holder, 1, '적용이 high 잠금 뒤에 서지 않았습니다');
        goOn();
        await other;
        const result = await applying;

        // 첫 시도는 교착으로 취소됐고(경고 한 줄), 다시 돈 적용은 지역이 바뀐 low 를 빼고 계산했다.
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ rpc: 'contacts.fieldworkShares.apply', attempt: 1 }),
          expect.any(String),
        );
        expect(result).toMatchObject({ matched: 99, after: 99 });
        const inA = await db
          .select({ id: fieldworkLinkShares.contactTargetId })
          .from(fieldworkLinkShares)
          .where(eq(fieldworkLinkShares.linkId, A.linkId));
        const ids = new Set(inA.map((r) => r.id));
        expect(ids.has(low)).toBe(false);
        expect(ids.has(high)).toBe(true);
        expect(ids.size).toBe(99);
      } finally {
        warn.mockRestore();
        await db
          .update(contactTargets)
          .set({ attrs: { 지역: '서울' } })
          .where(eq(contactTargets.id, low));
      }
    }, 30_000);

    it('겹치는 대상을 두 링크에 여러 번 동시에 가져와도 전부 성공하고, 대상마다 링크 하나에만 남는다', async () => {
      const runs = Array.from({ length: 8 }, (_, i) =>
        i % 2 === 0 ? apply(A, '1-60', 'take') : apply(B, '41-100', 'take'),
      );
      const settled = await Promise.allSettled(runs);
      expect(settled.filter((r) => r.status === 'rejected')).toEqual([]);

      const a = new Set(await shareResidsOf(A.linkId));
      const b = new Set(await shareResidsOf(B.linkId));
      expect(range(1, 40).every((r) => a.has(r) && !b.has(r))).toBe(true);
      expect(range(61, 100).every((r) => b.has(r) && !a.has(r))).toBe(true);
      expect(range(41, 60).every((r) => a.has(r) !== b.has(r))).toBe(true);
    }, 30_000);
  });
});
