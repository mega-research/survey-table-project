/**
 * 재설정·전이의 세션 폐기가 경합에서도 지켜지는가 (역할 모델 v2 티켓 30).
 *
 * Codex 적대적 리뷰(2026-08-26) 지적 2. 옛 해시를 이미 읽어둔 로그인이 폐기 커밋 **뒤에**
 * 세션을 INSERT 하면, 그 세션은 계정이 active 라 실제로 쓸 수 있다 — 하필 유출을 의심해
 * 재설정한 그 순간에 계약이 깨진다.
 *
 * 경합은 실 DB 로만 재현된다. 단위 테스트는 훅이 불리는지까지만 볼 수 있고, Better Auth 의
 * 로그인이 "해시 검증 → (별도 단계) 세션 INSERT" 로 갈라져 있다는 사실 자체를 확인할 수 없다.
 *
 * 실행 조건: DATABASE_URL 이 127.0.0.1/localhost 일 때만 (pnpm test:integration).
 */

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { accounts, sessions, userStatusEvents, users } from '@/db/schema';
import { auth } from '@/lib/auth/server';
import {
  runWithSessionRevocationMark,
  setSessionRevocationMark,
} from '@/lib/auth/session-revocation';
import { changeUserStatus, createUser, resetUserPassword } from '@/server/auth/services/users';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const PASSWORD = 'initial-pw-123';
const RESET_PASSWORD = 'reset-pw-4567';
const createdUserIds: string[] = [];

async function seedActor(): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    name: '슈퍼어드민',
    email: `ticket30-actor-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin: true,
    userType: 'internal',
  });
  createdUserIds.push(id);
  return id;
}

async function seedUser(actorId: string, prefix: string) {
  const email = `ticket30-${prefix}-${crypto.randomUUID()}@example.com`;
  const { id } = await createUser(actorId, {
    userType: 'internal',
    name: '김새로',
    email,
    password: PASSWORD,
  });
  createdUserIds.push(id);
  return { id, email };
}

async function sessionCount(userId: string) {
  const rows = await db.select().from(sessions).where(eq(sessions.userId, userId));
  return rows.length;
}

async function revokedAtOf(userId: string) {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { sessionsRevokedAt: true },
  });
  return row?.sessionsRevokedAt ?? null;
}

afterAll(async () => {
  if (!isLocalDb || createdUserIds.length === 0) return;
  await db.delete(userStatusEvents).where(inArray(userStatusEvents.userId, createdUserIds));
  await db.delete(userStatusEvents).where(inArray(userStatusEvents.changedBy, createdUserIds));
  await db.delete(sessions).where(inArray(sessions.userId, createdUserIds));
  await db.delete(accounts).where(inArray(accounts.userId, createdUserIds));
  await db.delete(users).where(inArray(users.id, createdUserIds));
});

describe.skipIf(!isLocalDb)('세션 폐기 경합 (real local DB)', () => {
  it('재설정이 폐기 표식을 남긴다', async () => {
    const actorId = await seedActor();
    const { id } = await seedUser(actorId, 'mark');
    expect(await revokedAtOf(id)).toBeNull();

    await resetUserPassword(actorId, { userId: id, password: RESET_PASSWORD });
    expect(await revokedAtOf(id)).toBeInstanceOf(Date);
  });

  it('상태 전이도 폐기 표식을 남긴다', async () => {
    const actorId = await seedActor();
    const { id } = await seedUser(actorId, 'mark-transition');
    await changeUserStatus(actorId, { action: 'suspend', userId: id });
    expect(await revokedAtOf(id)).toBeInstanceOf(Date);
  });

  it('로그인 시작 뒤 재설정이 끼어들면 세션이 만들어지지 않는다', async () => {
    const actorId = await seedActor();
    const { id, email } = await seedUser(actorId, 'race');

    // 로그인이 "시작된" 상태를 만든다 — 표식을 읽어둔 시점이 재설정보다 앞선다.
    const attempt = runWithSessionRevocationMark(async () => {
      setSessionRevocationMark({ userId: id, revokedAt: await revokedAtOf(id) });

      // 그 사이 슈퍼어드민이 재설정한다(새 해시 + 세션 폐기 + 표식 갱신).
      await resetUserPassword(actorId, { userId: id, password: RESET_PASSWORD });

      // 이제 옛 비밀번호로 로그인을 마친다. 해시 검증은 이미 지난 것으로 치고, 세션 생성
      // 단계에서 막혀야 한다 — 실제로는 옛 비밀번호가 더 이상 맞지 않으므로 새 비밀번호로
      // 같은 창을 재현한다(검증은 통과하지만 표식은 낡은 상태).
      return auth.api.signInEmail({ body: { email, password: RESET_PASSWORD } });
    });

    await expect(attempt).rejects.toThrow();
    expect(await sessionCount(id)).toBe(0);
  });

  it('표식이 그대로면 로그인은 정상 통과한다 (거짓 차단 없음)', async () => {
    const actorId = await seedActor();
    const { id, email } = await seedUser(actorId, 'clean');

    const signedIn = await runWithSessionRevocationMark(async () => {
      setSessionRevocationMark({ userId: id, revokedAt: await revokedAtOf(id) });
      return auth.api.signInEmail({ body: { email, password: PASSWORD } });
    });

    expect(signedIn.user.id).toBe(id);
    expect(await sessionCount(id)).toBe(1);
  });

  it('표식 저장소 밖의 로그인은 판정하지 않는다 (fail-open)', async () => {
    const actorId = await seedActor();
    const { id, email } = await seedUser(actorId, 'no-mark');
    const signedIn = await auth.api.signInEmail({ body: { email, password: PASSWORD } });
    expect(signedIn.user.id).toBe(id);
  });

  it('재설정 뒤 새로 시작한 로그인은 새 비밀번호로 통과한다', async () => {
    const actorId = await seedActor();
    const { id, email } = await seedUser(actorId, 'after-reset');
    await resetUserPassword(actorId, { userId: id, password: RESET_PASSWORD });

    const signedIn = await runWithSessionRevocationMark(async () => {
      setSessionRevocationMark({ userId: id, revokedAt: await revokedAtOf(id) });
      return auth.api.signInEmail({ body: { email, password: RESET_PASSWORD } });
    });

    expect(signedIn.user.id).toBe(id);
    expect(await sessionCount(id)).toBe(1);
  });
});
