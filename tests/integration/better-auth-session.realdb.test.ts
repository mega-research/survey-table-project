/**
 * Better Auth 서버 기반 실 DB 왕복 integration test (워크스페이스 역할 v2 티켓 01)
 *
 * 목적: Better Auth 인스턴스(lib/auth/server)가 실제 Postgres(선반영 5테이블 + 0085 정합)
 * 위에서 인증 기반 계약을 지킨다는 것을 CI 에 고정한다.
 *   - email+password sign-in 이 세션을 발급한다 (UUID user id, 30일 만기)
 *   - 발급된 세션 쿠키로 서버에서 세션을 검증할 수 있다 (getSession)
 *   - 사용 시 연장: updateAge 를 지난 세션은 getSession 이 만기를 다시 30일로 민다
 *   - 비활성 상태(pending/rejected/suspended/departed) sign-in 은 미존재 계정과
 *     완전히 동일한 401 로 차단된다 (이메일 존재 오라클 금지)
 *   - 공개 가입 없음: sign-up 은 disableSignUp 으로 차단 (autoSignIn 이전 단계에서 봉쇄)
 *
 * 실행 조건: DATABASE_URL 이 127.0.0.1/localhost 일 때만 (pnpm test:integration).
 * 시드는 시드 스크립트(scripts/seed-superadmin.ts)와 동일 방식의 직접 INSERT 다 —
 * v2 는 공개 가입이 없어 계정 생성 경로 자체가 직접 발급이기 때문이다(ADR-0018).
 */

import { hashPassword } from 'better-auth/crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { accounts, sessions, users } from '@/db/schema';
import { auth } from '@/lib/auth/server';
import {
  CREDENTIAL_PROVIDER_ID,
  LOCAL_CREDENTIAL_ISSUER,
  type UserStatus,
} from '@/shared/contracts/auth';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const PASSWORD = 'test-password-123';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const createdUserIds: string[] = [];

/** 시드 스크립트와 동일 규약의 직접 발급 (issuer='local:credential', accountId=userId). */
async function seedUser(status: UserStatus): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID();
  const email = `ba-ticket01-${id}@example.com`;
  const now = new Date();
  await db.insert(users).values({
    id,
    name: '통합테스트',
    email,
    emailVerified: true,
    status,
    userType: 'internal',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(accounts).values({
    id: crypto.randomUUID(),
    userId: id,
    accountId: id,
    providerId: CREDENTIAL_PROVIDER_ID,
    issuer: LOCAL_CREDENTIAL_ISSUER,
    password: await hashPassword(PASSWORD),
    createdAt: now,
    updatedAt: now,
  });
  createdUserIds.push(id);
  return { id, email };
}

/** sign-in 실패를 APIError 로 캡처한다. 성공하면 테스트 실패. */
async function captureSignInError(email: string): Promise<{ status: unknown; body: unknown }> {
  try {
    await auth.api.signInEmail({ body: { email, password: PASSWORD } });
  } catch (err) {
    const apiError = err as { status: unknown; body: unknown };
    return { status: apiError.status, body: apiError.body };
  }
  throw new Error('sign-in 이 차단되지 않았습니다.');
}

describe.skipIf(!isLocalDb)('Better Auth 세션 발급/검증 (real local DB)', () => {
  afterAll(async () => {
    if (createdUserIds.length > 0) {
      // sessions/accounts 는 FK cascade 로 함께 정리된다.
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  it('active 계정 sign-in: UUID user id 로 30일 세션을 발급하고 세션 쿠키를 내린다', async () => {
    const { id, email } = await seedUser('active');

    const before = Date.now();
    const { headers, response } = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });

    expect(response.user.id).toBe(id);
    expect(response.user.id).toMatch(UUID_RE);
    expect(response.token).toBeTruthy();

    const setCookie = headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('better-auth.session_token=');

    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.token, response.token as string));
    expect(row).toBeDefined();
    expect(row!.userId).toBe(id);
    const expiresMs = row!.expiresAt.getTime();
    expect(expiresMs).toBeGreaterThan(before + 29 * DAY_MS);
    expect(expiresMs).toBeLessThan(before + 31 * DAY_MS);
  });

  it('발급된 세션 쿠키로 getSession 검증이 되고 additionalFields 가 실려 온다', async () => {
    const { id, email } = await seedUser('active');
    const { headers } = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const cookiePair = (headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookiePair).toContain('better-auth.session_token=');

    const result = await auth.api.getSession({
      headers: new Headers({ cookie: cookiePair }),
    });

    expect(result).not.toBeNull();
    expect(result!.user.id).toBe(id);
    expect(result!.user.email).toBe(email);
    expect(result!.user.status).toBe('active');
    expect(result!.user.userType).toBe('internal');
    expect(result!.user.isSuperadmin).toBe(false);
    expect(result!.session.userId).toBe(id);
  });

  it('사용 시 연장: updateAge 를 지난 세션은 getSession 이 만기를 다시 30일로 민다', async () => {
    const { email } = await seedUser('active');
    const { headers, response } = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const token = response.token as string;
    const cookiePair = (headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    // 세션을 "발급 20일 경과" 상태로 되감는다 — 만기 10일 남음 (updateAge 1일 경과분).
    const tenDaysLater = new Date(Date.now() + 10 * DAY_MS);
    await db
      .update(sessions)
      .set({ expiresAt: tenDaysLater, updatedAt: new Date(Date.now() - 20 * DAY_MS) })
      .where(eq(sessions.token, token));

    const result = await auth.api.getSession({ headers: new Headers({ cookie: cookiePair }) });
    expect(result).not.toBeNull();

    const [row] = await db.select().from(sessions).where(eq(sessions.token, token));
    expect(row).toBeDefined();
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY_MS);
  });

  it.each(['pending', 'rejected', 'suspended', 'departed'] as const)(
    '%s 계정 sign-in 은 미존재 계정과 동일한 401 로 차단되고 세션이 생기지 않는다',
    async (status) => {
      const { id, email } = await seedUser(status);

      const blocked = await captureSignInError(email);
      const unknown = await captureSignInError(`no-such-${crypto.randomUUID()}@example.com`);

      // 이메일 존재 오라클 금지 — status·body 가 미존재 계정 응답과 완전히 같아야 한다.
      expect(blocked.status).toBe(unknown.status);
      expect(blocked.body).toEqual(unknown.body);

      const rows = await db.select().from(sessions).where(eq(sessions.userId, id));
      expect(rows).toHaveLength(0);
    },
  );

  it('잘못된 비밀번호도 미존재 계정과 동일한 401 이다', async () => {
    const { email } = await seedUser('active');
    let wrongPassword: { status: unknown; body: unknown } | null = null;
    try {
      await auth.api.signInEmail({ body: { email, password: 'wrong-password-999' } });
    } catch (err) {
      const apiError = err as { status: unknown; body: unknown };
      wrongPassword = { status: apiError.status, body: apiError.body };
    }
    const unknown = await captureSignInError(`no-such-${crypto.randomUUID()}@example.com`);
    expect(wrongPassword).not.toBeNull();
    expect(wrongPassword!.status).toBe(unknown.status);
    expect(wrongPassword!.body).toEqual(unknown.body);
  });

  it('공개 가입 차단: sign-up 은 disableSignUp 으로 거부되고 유저 행이 생기지 않는다', async () => {
    const email = `ba-ticket01-signup-${crypto.randomUUID()}@example.com`;
    await expect(
      auth.api.signUpEmail({ body: { name: '가입시도', email, password: PASSWORD } }),
    ).rejects.toMatchObject({ body: { code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' } });

    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(0);
  });
});
