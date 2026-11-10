/**
 * 옛 주소 다리 — 외주 링크가 여럿인 설문 (fieldwork-multi-company 티켓 10) — 실 로컬 DB.
 *
 * 옛 게스트 주소는 설문 id 하나만 담고 있다. 외주 링크가 업체 수만큼 서면 그 주소만으로는 어느
 * 업체의 링크로 보낼지 정할 수 없어서, 다리는 **이 브라우저가 든 유효한 세션**이나 **비밀번호**로
 * 링크를 고른다.
 *
 * 실 DB 인 이유: 「유효한 세션」은 서명이 아니라 링크 행의 `password_updated_at` 대조이고(비밀번호를
 * 바꾸면 끊긴다), 비밀번호 대조는 가역 암호문의 복호다. 목은 둘 다 테스트가 정한 값을 돌려줄 뿐이다.
 *
 * 관찰 지점은 바깥에서 보는 것 둘이다 — 다리 라우트가 돌려주는 **목적지**와, 다리 접속 표면이
 * 심고 지우는 **쿠키**. 그 쿠키로 다리를 다시 지나 어느 링크에 닿는지까지 본다.
 */
import { NextRequest } from 'next/server';

import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/legacy-guest-link/[surveyId]/[[...rest]]/route';
import { db } from '@/db';
import {
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { readFieldworkLinkSessions } from '@/lib/auth/access-link-session';
import { authenticateAccessLink } from '@/server/access-link';
import { isLegacyBridgeOpen } from '@/server/legacy-bridge';
import type { ORPCContext } from '@/server/context';
import { accessLinkSession } from '@/server/workspace/procedures/access-link-session';
import { accessLinks } from '@/server/workspace/procedures/access-links';

/**
 * 브라우저의 쿠키 저장소 — 접속 표면이 `next/headers` 의 `cookies()` 로 심고 지우는 것을 받는다.
 * 쿠키 쓰기는 요청 컨텍스트 안에서만 되고 vitest 에는 그 컨텍스트가 없어 이 자리만 목이다.
 */
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: async () => ({
    get: () => undefined,
    set: ({ name, value }: { name: string; value: string }) => void jar.set(name, value),
    delete: ({ name }: { name: string }) => void jar.delete(name),
  }),
}));

/** 레이트리밋 판정의 축만 기록한다 — 한도 계산은 Upstash 의 일이고 여기서 보는 것은 「무엇으로 세는가」다. */
const rateLimitCalls = vi.hoisted(
  () => [] as Array<{ group: string; ip: string; clientId: string | null }>,
);
vi.mock('@/lib/rate-limit/rate-limiter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit/rate-limiter')>()),
  isRateLimitedTwoTier: async (group: string, ip: string, clientId: string | null) => {
    rateLimitCalls.push({ group, ip, clientId });
    return false;
  },
}));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const ORIGIN = 'https://survey.example.com';
const OWNER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();
const GUEST_USER = crypto.randomUUID();

let surveyId = '';

const admin = createRouterClient(
  { accessLinks },
  {
    context: {
      db,
      user: {
        id: OWNER_ID,
        email: `legacy-bridge-${OWNER_ID}@example.com`,
        name: '다리연구원',
        status: 'active',
        isSuperadmin: false,
        userType: 'internal',
      },
    } satisfies ORPCContext,
  },
);

interface Cookie {
  name: string;
  value: string;
}

/** 링크를 발급하고 그 링크 입구(`/fw/<token>`)로 접속까지 마친다 — 업체 한 곳의 브라우저 쿠키. */
async function issueAndSignIn(password: string, label?: string) {
  const { link } = await admin.accessLinks.issue({
    surveyId,
    kind: 'fieldwork',
    password,
    ...(label ? { label } : {}),
  });
  const auth = await authenticateAccessLink(link.token, password);
  if (!auth.ok) throw new Error(`접속 실패: ${auth.reason}`);
  return { token: link.token, linkId: link.id, cookie: auth.cookie as Cookie };
}

/** 옛 주소로 들어온 요청 — 브라우저가 든 쿠키를 그대로 싣는다. */
async function visitBridge(cookies: Cookie[] = []) {
  const request = new NextRequest(
    `${ORIGIN}/api/legacy-guest-link/${surveyId}`,
    cookies.length > 0
      ? { headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') } }
      : undefined,
  );
  const res = await GET(request, { params: Promise.resolve({ surveyId }) });
  return {
    status: res.status,
    location: res.headers.get('location'),
    cache: res.headers.get('cache-control'),
  };
}

/** 이 브라우저(jar)의 쿠키를 요청 헤더로 — 브라우저가 다음 요청에 싣는 것과 같다. */
function jarCookies(): Cookie[] {
  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

/** 다리 비밀번호 화면의 한 번 제출 — 그 브라우저가 든 쿠키를 싣고 부른다. */
async function submitBridgePassword(password: string, target = surveyId) {
  const cookie = jarCookies()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const headers = new Headers({ 'x-real-ip': '203.0.113.7', ...(cookie ? { cookie } : {}) });
  const client = createRouterClient(
    { accessLinkSession },
    {
      context: {
        db,
        user: null,
        headers,
        linkSessions: readFieldworkLinkSessions(headers),
      } satisfies ORPCContext,
    },
  );
  return client.accessLinkSession.authenticateLegacyBridge({ surveyId: target, password });
}

const fwEntry = (token: string) => `${ORIGIN}/fw/${token}`;
const bridgePasswordPage = () => `${ORIGIN}/fw/legacy/${surveyId}`;

describe.skipIf(!isLocalDb)('옛 주소 다리 — 외주 링크 여럿 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values({
      id: OWNER_ID,
      name: '다리연구원',
      email: `legacy-bridge-${OWNER_ID}@example.com`,
      emailVerified: true,
      status: 'active',
      userType: 'internal',
    });
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `다리팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembersTable).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'leader' });
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    surveyId = crypto.randomUUID();
    await db.insert(surveysTable).values({
      id: surveyId,
      title: '인공지능산업 실태조사',
      teamId: TEAM_ID,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
    });
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST_USER}:${surveyId}`);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    jar.clear();
    rateLimitCalls.length = 0;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    await db.delete(teamMembersTable).where(eq(teamMembersTable.teamId, TEAM_ID));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(eq(usersTable.id, OWNER_ID));
  });

  describe('쿠키로 고르기', () => {
    it('외주 링크가 둘이고 이 브라우저에 그중 한 링크의 유효한 세션이 있으면 그 링크로 보낸다', async () => {
      const from = await issueAndSignIn('FromPass2026', '프롬');
      await issueAndSignIn('PrimePass2026', '프라임');

      const res = await visitBridge([from.cookie]);

      expect(res.status).toBe(307);
      expect(res.location).toBe(fwEntry(from.token));
      expect(res.cache).toBe('no-store');
    });

    it('외주 링크가 둘이고 쿠키가 없으면 다리 비밀번호 화면으로 보낸다 — 어느 링크 주소도 내주지 않는다', async () => {
      await issueAndSignIn('FromPass2026');
      await issueAndSignIn('PrimePass2026');

      const res = await visitBridge();

      expect(res.status).toBe(307);
      expect(res.location).toBe(bridgePasswordPage());
      expect(res.cache).toBe('no-store');
    });

    it('두 링크의 유효한 세션을 함께 들고 있으면 고르지 않고 비밀번호 화면으로 보낸다', async () => {
      const from = await issueAndSignIn('FromPass2026');
      const prime = await issueAndSignIn('PrimePass2026');

      const res = await visitBridge([from.cookie, prime.cookie]);

      expect(res.location).toBe(bridgePasswordPage());
    });

    it('비밀번호가 바뀐 링크의 쿠키는 유효한 세션이 아니다 — 비밀번호 화면으로 보낸다', async () => {
      const from = await issueAndSignIn('FromPass2026');
      await issueAndSignIn('PrimePass2026');
      await admin.accessLinks.resetPassword({
        surveyId,
        linkId: from.linkId,
        password: 'FromPass2027',
      });

      const res = await visitBridge([from.cookie]);

      expect(res.location).toBe(bridgePasswordPage());
    });

    it('끊긴 쿠키 하나와 산 쿠키 하나를 들면 산 쪽 링크로 보낸다', async () => {
      const from = await issueAndSignIn('FromPass2026');
      const prime = await issueAndSignIn('PrimePass2026');
      await admin.accessLinks.resetPassword({
        surveyId,
        linkId: from.linkId,
        password: 'FromPass2027',
      });

      const res = await visitBridge([from.cookie, prime.cookie]);

      expect(res.location).toBe(fwEntry(prime.token));
    });

    it('종료된 링크의 쿠키는 고르지 않는다 — 남은 링크가 둘이면 비밀번호 화면이다', async () => {
      const closed = await issueAndSignIn('ClosedPass2026');
      await issueAndSignIn('FromPass2026');
      await issueAndSignIn('PrimePass2026');
      await admin.accessLinks.close({ surveyId, linkId: closed.linkId });

      const res = await visitBridge([closed.cookie]);

      expect(res.location).toBe(bridgePasswordPage());
    });
  });

  describe('링크 수', () => {
    it('열린 외주 링크가 하나면 쿠키와 상관없이 지금처럼 그 링크로 보낸다', async () => {
      const only = await issueAndSignIn('OnlyPass2026');

      expect((await visitBridge()).location).toBe(fwEntry(only.token));
    });

    it('열린 외주 링크가 없으면 내부 콘솔 주소로 보낸다', async () => {
      const closed = await issueAndSignIn('ClosedPass2026');
      await admin.accessLinks.close({ surveyId, linkId: closed.linkId });

      expect((await visitBridge([closed.cookie])).location).toBe(
        `${ORIGIN}/surveys/${surveyId}/operations`,
      );
    });

    it('허용 목록 밖의 설문은 링크가 둘이고 유효한 쿠키가 있어도 내부 콘솔 주소로 보낸다', async () => {
      const from = await issueAndSignIn('FromPass2026');
      await issueAndSignIn('PrimePass2026');
      vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST_USER}:${crypto.randomUUID()}`);

      expect((await visitBridge([from.cookie])).location).toBe(
        `${ORIGIN}/surveys/${surveyId}/operations`,
      );
    });
  });

  describe('다리 비밀번호 화면', () => {
    it('맞는 비밀번호는 그 링크의 세션을 심고, 그 브라우저로 다리를 다시 지나면 그 링크 콘솔로 간다', async () => {
      await issueAndSignIn('FromPass2026', '프롬');
      const prime = await issueAndSignIn('PrimePass2026', '프라임');
      jar.clear();

      await expect(submitBridgePassword('PrimePass2026')).resolves.toEqual({ ok: true });

      expect([...jar.keys()]).toEqual([`fw_${prime.token}`]);
      expect((await visitBridge(jarCookies())).location).toBe(fwEntry(prime.token));
    });

    it('틀린 비밀번호는 쿠키 없이 denied 하나다 — 이름표·조사 이름·링크 목록이 응답에 없다', async () => {
      await issueAndSignIn('FromPass2026', '프롬');
      await issueAndSignIn('PrimePass2026', '프라임');
      jar.clear();

      const res = await submitBridgePassword('Wrong2026pw');

      expect(res).toEqual({ ok: false, reason: 'denied' });
      expect(jar.size).toBe(0);
      const body = JSON.stringify(res);
      for (const leak of ['프롬', '프라임', '인공지능산업']) expect(body).not.toContain(leak);
    });

    it('비밀번호가 두 링크에 다 맞으면 어느 쪽으로도 들어가지 않고 틀린 비밀번호와 같은 denied 다', async () => {
      await issueAndSignIn('SamePass2026');
      await issueAndSignIn('SamePass2026');
      jar.clear();

      expect(await submitBridgePassword('SamePass2026')).toEqual({ ok: false, reason: 'denied' });
      expect(jar.size).toBe(0);
    });

    it('종료된 링크의 비밀번호로는 들어가지 않는다', async () => {
      const closed = await issueAndSignIn('ClosedPass2026');
      await issueAndSignIn('FromPass2026');
      await issueAndSignIn('PrimePass2026');
      await admin.accessLinks.close({ surveyId, linkId: closed.linkId });
      jar.clear();

      expect(await submitBridgePassword('ClosedPass2026')).toEqual({ ok: false, reason: 'denied' });
      expect(jar.size).toBe(0);
    });

    it('앞뒤 공백은 버린다 — 발급 쪽과 같은 규칙이다', async () => {
      await issueAndSignIn('FromPass2026');
      const prime = await issueAndSignIn('PrimePass2026');
      jar.clear();

      expect(await submitBridgePassword('  PrimePass2026 ')).toEqual({ ok: true });
      expect([...jar.keys()]).toEqual([`fw_${prime.token}`]);
    });

    it('같은 설문의 다른 링크 쿠키는 지우고 새 링크 세션만 남긴다 — 한 브라우저 = 설문당 외주 세션 하나', async () => {
      const from = await issueAndSignIn('FromPass2026');
      const prime = await issueAndSignIn('PrimePass2026');
      jar.clear();
      jar.set(from.cookie.name, from.cookie.value);

      expect(await submitBridgePassword('PrimePass2026')).toEqual({ ok: true });

      expect([...jar.keys()]).toEqual([`fw_${prime.token}`]);
      expect((await visitBridge(jarCookies())).location).toBe(fwEntry(prime.token));
    });

    it('다른 설문의 외주 쿠키는 건드리지 않는다', async () => {
      await issueAndSignIn('FromPass2026');
      const prime = await issueAndSignIn('PrimePass2026');
      jar.clear();
      // 다른 설문의 링크 세션 — 이 설문의 다리 접속과 무관하다.
      const otherSurvey = surveyId;
      surveyId = crypto.randomUUID();
      await db.insert(surveysTable).values({
        id: surveyId,
        title: '다른 조사',
        teamId: TEAM_ID,
        visibility: 'team',
        assignmentStatus: 'assigned',
        ownerUserId: OWNER_ID,
        createdBy: OWNER_ID,
      });
      const elsewhere = await issueAndSignIn('ElsewherePass2026');
      await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
      surveyId = otherSurvey;
      jar.clear();
      jar.set(elsewhere.cookie.name, elsewhere.cookie.value);

      expect(await submitBridgePassword('PrimePass2026')).toEqual({ ok: true });

      expect(new Set(jar.keys())).toEqual(new Set([elsewhere.cookie.name, `fw_${prime.token}`]));
    });

    it('맞는 비밀번호여도 설문이 중단돼 있으면 쿠키 없이 closed 다', async () => {
      await issueAndSignIn('FromPass2026');
      await issueAndSignIn('PrimePass2026');
      await db.update(surveysTable).set({ isPaused: true }).where(eq(surveysTable.id, surveyId));
      jar.clear();

      expect(await submitBridgePassword('PrimePass2026')).toEqual({ ok: false, reason: 'closed' });
      expect(jar.size).toBe(0);
      // 틀린 비밀번호에는 닫힘을 말해 주지 않는다.
      expect(await submitBridgePassword('Wrong2026pw')).toEqual({ ok: false, reason: 'denied' });
    });

    it('삭제된 설문이면 맞는 비밀번호에도 쿠키 없이 closed 다', async () => {
      await issueAndSignIn('FromPass2026');
      await issueAndSignIn('PrimePass2026');
      await db
        .update(surveysTable)
        .set({ deletedAt: new Date() })
        .where(eq(surveysTable.id, surveyId));
      jar.clear();

      expect(await submitBridgePassword('PrimePass2026')).toEqual({ ok: false, reason: 'closed' });
      expect(jar.size).toBe(0);
      // 입구는 그대로 비밀번호 칸이다 — 닫힘은 맞는 비밀번호 뒤에만 말한다.
      expect(isLegacyBridgeOpen(surveyId)).toBe(true);
    });

    it('허용 목록 밖 설문은 맞는 비밀번호여도 denied 다', async () => {
      await issueAndSignIn('FromPass2026');
      await issueAndSignIn('PrimePass2026');
      jar.clear();
      vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST_USER}:${crypto.randomUUID()}`);

      expect(await submitBridgePassword('PrimePass2026')).toEqual({ ok: false, reason: 'denied' });
      expect(jar.size).toBe(0);
    });

    it('허용 목록이 비면 다리 접속이 통째로 꺼진다', async () => {
      await issueAndSignIn('FromPass2026');
      await issueAndSignIn('PrimePass2026');
      jar.clear();
      vi.stubEnv('GUEST_SURVEY_GRANTS', '');

      expect(await submitBridgePassword('PrimePass2026')).toEqual({ ok: false, reason: 'denied' });
      expect(jar.size).toBe(0);
    });

    it('시도 제한은 설문 축이다 — 토큰이 아니라 설문 id 로 센다', async () => {
      await submitBridgePassword('Wrong2026pw');

      expect(rateLimitCalls).toEqual([
        { group: 'access-link-auth', ip: '203.0.113.7', clientId: surveyId },
      ]);
    });
  });

  describe('다리 비밀번호 화면의 입구', () => {
    it('열린 설문이면 비밀번호 칸이다', async () => {
      await issueAndSignIn('FromPass2026', '프롬');
      await issueAndSignIn('PrimePass2026', '프라임');

      expect(isLegacyBridgeOpen(surveyId)).toBe(true);
    });

    it('설문이 중단돼 있어도 비밀번호 칸이다 — 닫힘은 비밀번호 없이 말하지 않는다', async () => {
      await issueAndSignIn('FromPass2026');
      await issueAndSignIn('PrimePass2026');
      await db.update(surveysTable).set({ isPaused: true }).where(eq(surveysTable.id, surveyId));

      expect(isLegacyBridgeOpen(surveyId)).toBe(true);
      // 닫힘을 듣는 길은 맞는 비밀번호 하나다.
      expect(await submitBridgePassword('Wrong2026pw')).toEqual({ ok: false, reason: 'denied' });
      expect(await submitBridgePassword('PrimePass2026')).toEqual({ ok: false, reason: 'closed' });
    });

    it('열린 외주 링크가 없어도 비밀번호 칸이다 — 「링크가 없다」를 말하지 않는다', async () => {
      expect(isLegacyBridgeOpen(surveyId)).toBe(true);
    });

    it('허용 목록 밖이면 닫혀 있다 — 화면이 다리가 꺼진 자리로 보낸다', async () => {
      vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST_USER}:${crypto.randomUUID()}`);

      expect(isLegacyBridgeOpen(surveyId)).toBe(false);
    });
  });
});
