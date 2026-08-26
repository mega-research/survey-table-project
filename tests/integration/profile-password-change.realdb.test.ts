/**
 * 프로필 비밀번호 변경 실 DB 왕복 integration test (역할 모델 v2 티켓 05).
 *
 * 이 티켓의 약속은 재설정(티켓 04)과 정확히 반대편이다 — 재설정은 **모든** 세션을 끊지만
 * 본인 변경은 **지금 쓰는 세션만 남기고** 나머지를 끊는다. 그 차이는 세션 테이블을 실제로
 * 들여다봐야 증명된다. 현재 비밀번호 재인증도 Better Auth 에 위임돼 있어 실 인스턴스로만
 * 확인할 수 있다.
 *
 * 실행 조건: DATABASE_URL 이 127.0.0.1/localhost 일 때만 (pnpm test:integration).
 */

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { accounts, sessions, userStatusEvents, users } from '@/db/schema';
import { auth } from '@/lib/auth/server';
import { getProfile, updatePassword, updateProfile } from '@/server/auth/services/auth';
import { createUser } from '@/server/auth/services/users';
import { InvalidAvatarUrlError } from '@/server/auth/domain/auth';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const PASSWORD = 'initial-pw-123';
const NEW_PASSWORD = 'changed-pw-456';
const createdUserIds: string[] = [];

async function seedActor(): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    name: '슈퍼어드민',
    email: `ticket05-actor-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin: true,
    userType: 'internal',
  });
  createdUserIds.push(id);
  return id;
}

async function seedUser(prefix: string): Promise<{ id: string; email: string }> {
  const actorId = await seedActor();
  const email = `ticket05-${prefix}-${crypto.randomUUID()}@example.com`;
  const { id } = await createUser(actorId, {
    userType: 'internal',
    name: '김새로',
    email,
    password: PASSWORD,
  });
  createdUserIds.push(id);
  return { id, email };
}

/** 로그인해서 세션 쿠키가 실린 헤더를 만든다 — changePassword 는 이 헤더로 세션을 특정한다. */
async function signInHeaders(email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const setCookie = response.headers.get('set-cookie') ?? '';
  const cookie = setCookie
    .split(/,(?=[^;]+?=)/)
    .map((part) => part.split(';')[0]?.trim() ?? '')
    .filter(Boolean)
    .join('; ');
  return new Headers({ cookie });
}

async function sessionTokens(userId: string): Promise<string[]> {
  const rows = await db.select({ token: sessions.token }).from(sessions).where(eq(sessions.userId, userId));
  return rows.map((row) => row.token);
}

afterAll(async () => {
  if (!isLocalDb || createdUserIds.length === 0) return;
  await db.delete(userStatusEvents).where(inArray(userStatusEvents.userId, createdUserIds));
  await db.delete(userStatusEvents).where(inArray(userStatusEvents.changedBy, createdUserIds));
  await db.delete(sessions).where(inArray(sessions.userId, createdUserIds));
  await db.delete(accounts).where(inArray(accounts.userId, createdUserIds));
  await db.delete(users).where(inArray(users.id, createdUserIds));
});

describe.skipIf(!isLocalDb)('비밀번호 변경 (real local DB)', () => {
  it('다른 기기 세션만 끊기고 로그인 상태 하나가 남는다', async () => {
    const { id, email } = await seedUser('change');
    // 두 기기에서 로그인한 상태를 만든다.
    const other = await signInHeaders(email, PASSWORD);
    const current = await signInHeaders(email, PASSWORD);
    const before = await sessionTokens(id);
    expect(before).toHaveLength(2);

    const result = await updatePassword(current, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(result).toEqual({ success: true });

    // 재설정(티켓 04)이 전부 끊는 것과 갈리는 지점 — 로그인 상태 하나가 남는다.
    const remaining = await sessionTokens(id);
    expect(remaining).toHaveLength(1);

    // 남은 것이 다른 기기 것이 아니다. Better Auth 는 변경하면서 현재 세션 토큰을 새로
    // 발급하고 새 쿠키를 응답에 실어 준다(nextCookies) — 그래서 "남은 토큰 === 보냈던 토큰"
    // 으로는 확인할 수 없고, 확인해서도 안 된다(토큰 회전은 바람직한 동작이다).
    const otherToken = other.get('cookie') ?? '';
    expect(otherToken).not.toContain(remaining[0]);
  });

  it('바꾼 비밀번호로만 다시 로그인된다', async () => {
    const { email } = await seedUser('relogin');
    const current = await signInHeaders(email, PASSWORD);
    await updatePassword(current, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    await expect(auth.api.signInEmail({ body: { email, password: NEW_PASSWORD } })).resolves.toMatchObject({
      user: { email },
    });
    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD } }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
  });

  it('현재 비밀번호가 틀리면 바뀌지 않고 세션도 그대로다', async () => {
    const { id, email } = await seedUser('wrong-current');
    await signInHeaders(email, PASSWORD);
    const current = await signInHeaders(email, PASSWORD);

    const result = await updatePassword(current, {
      currentPassword: 'not-the-password',
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(result).toEqual({ error: '현재 비밀번호가 올바르지 않습니다.' });

    // 실패했으니 다른 기기 세션도 살아 있어야 한다.
    expect(await sessionTokens(id)).toHaveLength(2);
    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD } }),
    ).resolves.toMatchObject({ user: { email } });
  });
});

describe.skipIf(!isLocalDb)('프로필 조회·수정 (real local DB)', () => {
  it('발급된 계정의 프로필을 읽는다', async () => {
    const { id, email } = await seedUser('profile');
    await expect(getProfile(id)).resolves.toMatchObject({
      id,
      email,
      userType: 'internal',
      image: null,
    });
  });

  it('이름과 아바타를 저장하고 되읽는다', async () => {
    const { id } = await seedUser('save');
    const publicUrl = process.env['CLOUDFLARE_R2_PUBLIC_URL'];
    // R2 env 가 없는 환경에서는 아바타 저장 자체가 거부되는 것이 정상 동작이다.
    const image = publicUrl ? `${publicUrl}/avatars/${id}/a.webp` : null;

    const updated = await updateProfile(id, { name: '김바뀜', image });
    expect(updated).toMatchObject({ name: '김바뀜', image });
    await expect(getProfile(id)).resolves.toMatchObject({ name: '김바뀜', image });
  });

  it('우리 것이 아닌 아바타 주소는 저장되지 않는다', async () => {
    const { id } = await seedUser('evil-avatar');
    await expect(
      updateProfile(id, { name: '김새로', image: 'https://evil.example/x.png' }),
    ).rejects.toBeInstanceOf(InvalidAvatarUrlError);
    await expect(getProfile(id)).resolves.toMatchObject({ image: null });
  });
});
