/**
 * 단건 표면을 담당 범위로 막는다 — 실 로컬 DB (fieldwork-multi-company 티켓 05, ADR-0035).
 *
 * 한 설문에 외주 링크 A·B. 조사 대상 시스템ID 1·2 는 A, 3·4 는 B, 5 는 둘이 같이 맡고, 6 은 어느 링크에도
 * 없다. A 세션으로 **라우터 클라이언트**와 `/fw` 조사 대상 상세 페이지를 직접 부른다 — 외주가 바깥에서
 * 보는 결과만 본다.
 *
 * - 범위 밖 대상 id 로 상세·회차 추가·수정·삭제·메모·단건 메일·메일 미리보기를 부르면 전부 「없음」이고
 *   DB 에 아무것도 쓰이지 않는다(권한 없음과 없음을 가르지 않는다).
 * - 같이 맡은 대상은 A·B 모두 상세·회차·메일이 된다.
 * - 범위 밖 대상의 초대 토큰으로 링크 주체가 대행 진입하면 거부된다 — 응답자 본인의 진입은 그대로.
 * - 범위 안 대상의 상세에 다른 외주가 남긴 회차가 「외주」로 보인다(대상의 기록은 대상의 것).
 *
 * 실 DB 인 이유: 범위는 WHERE 의 서브쿼리다. 목이 돌려주는 행은 테스트가 정한 행이라 술어가 무엇이든
 * 통과한다. 범위는 나누기 RPC 가 아니라 표에 직접 깐다 — 이 스위트의 관심은 「나눠진 뒤 무엇이 보이나」다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { createRouterClient } from '@orpc/server';
import { eq, inArray } from 'drizzle-orm';
import { isValidElement, type ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactAttempts,
  contactTargetEditLogs,
  contactTargets,
  fieldworkLinkShares,
  mailCampaigns,
  mailTemplates,
  surveyAccessLinks,
  surveyResponses,
  surveys,
  teamMembers,
  teams,
  users,
} from '@/db/schema';
import { upsertPiiValue } from '@/lib/crypto/contact-pii-repo';
import { readFieldworkLinkSessions } from '@/lib/auth/access-link-session';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import type { ORPCContext } from '@/server/context';

const requestState = vi.hoisted(() => ({ headers: new Headers() }));

// 관문(`assertFieldworkLinkPageAccess`)과 응답 진입 서비스가 요청 헤더를 읽는다 — vitest 에는 요청
// 컨텍스트가 없어 그 자리만 세운다. 「테스트 데이터 보기」 쿠키는 없다(외부 주체는 늘 실데이터).
vi.mock('next/headers', () => ({
  headers: async () => requestState.headers,
  cookies: async () => ({ get: () => undefined }),
}));

// notFound·redirect 는 던지는 신호다. 실제 Next 런타임과 같은 방향이라 단언이 성립한다.
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

// 단건 발송은 커밋 뒤 Inngest 이벤트를 낸다 — 큐 등록만 받아 둔다.
const inngestSend = vi.hoisted(() => vi.fn(async () => ({ ids: [] })));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: inngestSend } }));

const { authenticateAccessLink } = await import('@/server/access-link');
const { router } = await import('@/server/router');
const { response: responseProcedures } = await import(
  '@/server/survey-response/procedures/response'
);
const { lifecycle: lifecycleProcedures } = await import(
  '@/server/survey-response/procedures/lifecycle'
);
const { default: FieldworkLinkContactDetailPage } = await import(
  '@/app/fw/[token]/operations/contacts/[contactId]/page'
);

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

const OWNER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();
const CLIENT_IP = '203.0.113.27';

const SCHEME: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: '기업명', label: '기업명', source: 'attrs.기업명', order: 2 },
    { key: '이메일', label: '이메일', source: 'pii.이메일', order: 3, piiType: 'email' },
  ],
};

const owner = createRouterClient(router, {
  context: {
    db,
    user: {
      id: OWNER_ID,
      email: `single-${OWNER_ID}@example.com`,
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

function linkHeaders(link: SignedLink | null): Headers {
  return new Headers({
    'x-real-ip': CLIENT_IP,
    'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0',
    ...(link ? { cookie: `${link.cookie.name}=${link.cookie.value}` } : {}),
  });
}

function linkContext(link: SignedLink): ORPCContext {
  const headers = linkHeaders(link);
  return { db, user: null, headers, linkSessions: readFieldworkLinkSessions(headers) };
}

const linkClient = (link: SignedLink) => createRouterClient(router, { context: linkContext(link) });

/** 응답 화면의 진입 표면 — 대행은 링크 쿠키를 든 채 응답자와 같은 `pub` procedure 를 부른다. */
function responseClient(link: SignedLink | null) {
  const context: ORPCContext = link
    ? linkContext(link)
    : { db, user: null, headers: linkHeaders(null) };
  return createRouterClient(
    { response: responseProcedures, lifecycle: lifecycleProcedures },
    { context },
  );
}

let surveyId = '';
let templateId = '';
let A: SignedLink;
let B: SignedLink;
/** 시스템ID → 조사 대상 id */
const T = new Map<number, string>();
/** 시스템ID → 초대 토큰 */
const INVITE = new Map<number, string>();

const target = (resid: number) => {
  const id = T.get(resid);
  if (!id) throw new Error(`대상 ${resid} 없음`);
  return id;
};

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

/** 그 링크에 범위를 깐다 — 「나눈 적 있음」과 범위 행. */
async function setShare(link: SignedLink, resids: number[]) {
  await db
    .update(surveyAccessLinks)
    .set({ shareAppliedAt: new Date(), shareClauses: [] })
    .where(eq(surveyAccessLinks.id, link.linkId));
  await db.delete(fieldworkLinkShares).where(eq(fieldworkLinkShares.linkId, link.linkId));
  if (resids.length > 0) {
    await db
      .insert(fieldworkLinkShares)
      .values(resids.map((r) => ({ linkId: link.linkId, contactTargetId: target(r) })));
  }
}

/** `/fw/<token>/operations/contacts/<id>` — 페이지를 부르고 그 본문(스크린)까지 그린다. */
async function fwDetail(link: SignedLink, contactId: string) {
  requestState.headers = linkHeaders(link);
  const page = await FieldworkLinkContactDetailPage({
    params: Promise.resolve({ token: link.token, contactId }),
  });
  if (!isValidElement<Record<string, unknown>>(page) || typeof page.type !== 'function') {
    throw new Error('페이지가 스크린 요소를 돌려주지 않았다');
  }
  const screen = await (page.type as (p: unknown) => Promise<ReactNode>)(page.props);
  const form = findPropsWith(screen, 'initial');
  if (!form) throw new Error('상세 폼을 찾지 못했다');
  return form as {
    initial: {
      id: string;
      resid: number;
      inviteCode: string | null;
      attempts: { attemptNo: number; createdByEmail: string | null; resultCode: string }[];
    };
  };
}

/** 요소 트리에서 그 prop 을 가진 첫 요소의 props — RSC 가 클라이언트 폼에 넘기는 payload 다. */
function findPropsWith(node: ReactNode, key: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findPropsWith(child, key);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (key in node.props) return node.props;
  return findPropsWith(node.props['children'] as ReactNode, key);
}

/** 그 대상에 쓰인 것 전부 — 「아무것도 쓰이지 않는다」의 근거. */
async function writesOn(contactTargetId: string) {
  const [row] = await db
    .select({ memo: contactTargets.memo, contactMethod: contactTargets.contactMethod })
    .from(contactTargets)
    .where(eq(contactTargets.id, contactTargetId));
  const attempts = await db
    .select({ id: contactAttempts.id, resultCode: contactAttempts.resultCode })
    .from(contactAttempts)
    .where(eq(contactAttempts.contactTargetId, contactTargetId));
  const editLogs = await db
    .select({ id: contactTargetEditLogs.id })
    .from(contactTargetEditLogs)
    .where(eq(contactTargetEditLogs.contactTargetId, contactTargetId));
  const campaigns = await db
    .select({ id: mailCampaigns.id })
    .from(mailCampaigns)
    .where(eq(mailCampaigns.surveyId, surveyId));
  return { target: row, attempts, editLogs: editLogs.length, campaigns: campaigns.length };
}

function entryInput(inviteToken: string) {
  return {
    surveyId,
    sessionId: crypto.randomUUID(),
    versionId: null,
    currentStepId: 'step-1',
    clientSignals: null,
    inviteToken,
  };
}

run('담당 범위 — 단건 표면 (real DB)', () => {
  beforeAll(async () => {
    process.env['NEXT_PUBLIC_APP_URL'] ??= 'http://localhost:3000';
    await db.insert(users).values({
      id: OWNER_ID,
      email: `single-${OWNER_ID}@example.com`,
      name: '연구원',
      emailVerified: true,
      status: 'active',
      userType: 'internal',
    });
    await db.insert(teams).values({ id: TEAM_ID, name: `단건팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembers).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'leader' });
    surveyId = crypto.randomUUID();
    await db.insert(surveys).values({
      id: surveyId,
      title: '단건 범위 조사',
      teamId: TEAM_ID,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
      status: 'published',
      isPublic: true,
      contactColumns: SCHEME,
      testContactColumns: SCHEME,
    });
    for (const resid of [1, 2, 3, 4, 5, 6]) {
      const inviteToken = crypto.randomUUID();
      const [row] = await db
        .insert(contactTargets)
        .values({
          surveyId,
          resid,
          isTest: false,
          inviteToken,
          inviteCode: `st${crypto.randomUUID().slice(0, 12)}`,
          attrs: { 기업명: `기업${resid}` },
        })
        .returning({ id: contactTargets.id });
      if (!row) throw new Error('대상 시드 실패');
      T.set(resid, row.id);
      INVITE.set(resid, inviteToken);
      await db.transaction((tx) =>
        upsertPiiValue(tx, row.id, '이메일', 'email', `target${resid}@example.com`),
      );
    }
    templateId = crypto.randomUUID();
    await db.insert(mailTemplates).values({
      id: templateId,
      surveyId,
      name: '안내 메일',
      subject: '조사 안내',
      bodyHtml: '<p>안내</p>',
    });

    A = await issueAndSignIn('프롬');
    B = await issueAndSignIn('프라임');
    await setShare(A, [1, 2, 5]);
    await setShare(B, [3, 4, 5]);
  });

  beforeEach(async () => {
    inngestSend.mockClear();
    const ids = [...T.values()];
    await db.delete(surveyResponses).where(eq(surveyResponses.surveyId, surveyId));
    await db.delete(mailCampaigns).where(eq(mailCampaigns.surveyId, surveyId));
    await db.delete(contactAttempts).where(inArray(contactAttempts.contactTargetId, ids));
    await db.delete(contactTargetEditLogs).where(inArray(contactTargetEditLogs.contactTargetId, ids));
    await db
      .update(contactTargets)
      .set({ memo: null, contactMethod: null })
      .where(inArray(contactTargets.id, ids));
  });

  afterAll(async () => {
    if (surveyId) {
      if (A && B) {
        await db
          .delete(fieldworkLinkShares)
          .where(inArray(fieldworkLinkShares.linkId, [A.linkId, B.linkId]));
      }
      await db.delete(surveys).where(eq(surveys.id, surveyId));
    }
    await db.delete(teamMembers).where(eq(teamMembers.userId, OWNER_ID));
    await db.delete(teams).where(eq(teams.id, TEAM_ID));
    await db.delete(users).where(eq(users.id, OWNER_ID));
  });

  describe('범위 밖 대상 — 단건 표면 전부가 「없음」이고 아무것도 쓰이지 않는다', () => {
    /** B 가 남긴 회차 하나 — A 가 고치거나 지우려 들 대상. */
    async function attemptByB(resid: number) {
      return linkClient(B).contacts.attempts.add({
        surveyId,
        contactTargetId: target(resid),
        resultCode: '부재',
      });
    }

    it.each([3, 6])('상세 — 시스템ID %i 는 notFound 다', async (resid) => {
      await expect(fwDetail(A, target(resid))).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it.each([3, 6])('회차 추가 — 시스템ID %i 는 NOT_FOUND 이고 회차가 생기지 않는다', async (resid) => {
      const before = await writesOn(target(resid));
      await expect(
        linkClient(A).contacts.attempts.add({
          surveyId,
          contactTargetId: target(resid),
          resultCode: '부재',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await writesOn(target(resid))).toEqual(before);
    });

    it('회차 수정 — B 대상의 회차는 NOT_FOUND 이고 그대로다', async () => {
      const { id } = await attemptByB(3);
      const before = await writesOn(target(3));
      await expect(
        linkClient(A).contacts.attempts.update({
          surveyId,
          contactTargetId: target(3),
          id,
          resultCode: '거절',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await writesOn(target(3))).toEqual(before);
    });

    it('회차 삭제 — B 대상의 회차는 NOT_FOUND 이고 남는다', async () => {
      const { id } = await attemptByB(4);
      const before = await writesOn(target(4));
      await expect(
        linkClient(A).contacts.attempts.remove({ surveyId, contactTargetId: target(4), id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await writesOn(target(4))).toEqual(before);
    });

    it.each([3, 6])('메모 — 시스템ID %i 는 NOT_FOUND 이고 메모가 비어 있다', async (resid) => {
      await expect(
        linkClient(A).contacts.targets.setMemo({
          surveyId,
          id: target(resid),
          memo: '다시 걸기',
          contactMethod: 'visit',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await writesOn(target(resid))).toEqual({
        target: { memo: null, contactMethod: null },
        attempts: [],
        editLogs: 0,
        campaigns: 0,
      });
    });

    it.each([3, 6])('단건 메일 — 시스템ID %i 는 NOT_FOUND 이고 캠페인이 생기지 않는다', async (resid) => {
      await expect(
        linkClient(A).mail.campaigns.sendSingle({
          surveyId,
          contactTargetId: target(resid),
          mailTemplateId: templateId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await writesOn(target(resid))).campaigns).toBe(0);
      expect(inngestSend).not.toHaveBeenCalled();
    });

    it.each([3, 6])('메일 미리보기 — 시스템ID %i 는 없는 대상과 같은 null 이다(주소·초대 링크가 실리지 않는다)', async (resid) => {
      await expect(
        linkClient(A).mail.preview.contactSample({ surveyId, contactTargetId: target(resid) }),
      ).resolves.toBeNull();
    });

    it('범위 밖과 없는 대상이 같은 답이다 — 존재가 드러나지 않는다', async () => {
      const missing = crypto.randomUUID();
      const outside = await linkClient(A).mail.preview.contactSample({ surveyId, contactTargetId: target(3) });
      const absent = await linkClient(A).mail.preview.contactSample({ surveyId, contactTargetId: missing });
      expect(outside).toBeNull();
      expect(outside).toEqual(absent);
      await expect(fwDetail(A, missing)).rejects.toThrow('NEXT_NOT_FOUND');
    });
  });

  describe('범위 안 대상 — 지금처럼 다 된다', () => {
    it.each([
      ['A 자기 대상', () => A, 1],
      ['A 같이 맡은 대상', () => A, 5],
      ['B 같이 맡은 대상', () => B, 5],
    ] as const)('%s — 상세·회차·메모·메일 미리보기·단건 메일이 된다', async (_, linkOf, resid) => {
      const link = linkOf();
      const client = linkClient(link);
      const detail = await fwDetail(link, target(resid));
      expect(detail.initial.resid).toBe(resid);

      const { id } = await client.contacts.attempts.add({
        surveyId,
        contactTargetId: target(resid),
        resultCode: '부재',
      });
      await client.contacts.attempts.update({
        surveyId,
        contactTargetId: target(resid),
        id,
        resultCode: '약속',
      });
      await client.contacts.targets.setMemo({
        surveyId,
        id: target(resid),
        memo: '오후에 다시',
        contactMethod: 'visit',
      });
      const sample = await client.mail.preview.contactSample({
        surveyId,
        contactTargetId: target(resid),
      });
      expect(sample?.email).toBe(`target${resid}@example.com`);
      const sent = await client.mail.campaigns.sendSingle({
        surveyId,
        contactTargetId: target(resid),
        mailTemplateId: templateId,
      });
      expect(sent.queuedCount).toBe(1);
      await client.contacts.attempts.remove({ surveyId, contactTargetId: target(resid), id });

      const writes = await writesOn(target(resid));
      expect(writes.target).toEqual({ memo: '오후에 다시', contactMethod: 'visit' });
      expect(writes.attempts).toEqual([]);
    });

    it('같이 맡은 대상의 상세에 다른 외주가 남긴 회차가 「외주」로 보인다', async () => {
      await linkClient(B).contacts.attempts.add({
        surveyId,
        contactTargetId: target(5),
        resultCode: '거절',
      });
      const detail = await fwDetail(A, target(5));
      expect(detail.initial.attempts).toEqual([
        expect.objectContaining({ attemptNo: 1, resultCode: '거절', createdByEmail: '외주' }),
      ]);
      // 이름표는 연구원의 메모다 — 외주 콘솔 payload 에는 어떤 모양으로도 실리지 않는다.
      expect(JSON.stringify(detail)).not.toMatch(/프라임|프롬/);
    });

    it('범위를 옮기면 같은 세션의 다음 요청부터 상세가 바뀐다', async () => {
      await expect(fwDetail(A, target(6))).rejects.toThrow('NEXT_NOT_FOUND');
      await setShare(A, [1, 2, 5, 6]);
      try {
        expect((await fwDetail(A, target(6))).initial.resid).toBe(6);
      } finally {
        await setShare(A, [1, 2, 5]);
      }
    });
  });

  describe('대리 응답 진입', () => {
    it.each([
      ['응답 시작', (link: SignedLink | null, token: string) =>
        responseClient(link).response.createBlank(entryInput(token))],
      ['이어서 응답', (link: SignedLink | null, token: string) =>
        responseClient(link).lifecycle.resume(entryInput(token))],
    ] as const)('%s — 범위 밖 대상의 초대 토큰으로 링크가 대행하면 거부되고 응답이 생기지 않는다', async (_, enter) => {
      for (const resid of [3, 6]) {
        await expect(enter(A, INVITE.get(resid) ?? '')).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
      }
      const rows = await db
        .select({ id: surveyResponses.id })
        .from(surveyResponses)
        .where(eq(surveyResponses.surveyId, surveyId));
      expect(rows).toEqual([]);
    });

    it('범위 밖 대상이 이미 완료했어도 완료 여부가 아니라 「없음」으로 답한다', async () => {
      await db.insert(surveyResponses).values({
        surveyId,
        sessionId: crypto.randomUUID(),
        contactTargetId: target(3),
        isCompleted: true,
        completedAt: new Date(),
        status: 'completed',
        questionResponses: {},
      });
      await expect(
        responseClient(A).response.createBlank(entryInput(INVITE.get(3) ?? '')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('범위 안 대상은 대행되고 링크 칸에 귀속이 찍힌다 — 같이 맡은 대상은 둘 다', async () => {
      for (const [link, resid] of [
        [A, 1],
        [A, 5],
        [B, 5],
      ] as const) {
        const result = await responseClient(link).response.createBlank(
          entryInput(INVITE.get(resid) ?? ''),
        );
        expect(result.kind).toBe('created');
        const [row] = await db
          .select({ fieldworkLinkId: surveyResponses.fieldworkLinkId })
          .from(surveyResponses)
          .where(eq(surveyResponses.id, (result as { id: string }).id));
        expect(row?.fieldworkLinkId).toBe(link.linkId);
      }
    });

    it('응답자 본인의 진입은 그대로다 — 어느 링크 범위에도 없는 대상도 들어온다', async () => {
      const result = await responseClient(null).response.createBlank(
        entryInput(INVITE.get(6) ?? ''),
      );
      expect(result.kind).toBe('created');
      const [row] = await db
        .select({ fieldworkLinkId: surveyResponses.fieldworkLinkId })
        .from(surveyResponses)
        .where(eq(surveyResponses.contactTargetId, target(6)));
      expect(row?.fieldworkLinkId).toBeNull();
    });
  });
});
