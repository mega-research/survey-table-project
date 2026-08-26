/**
 * 계정 직접 발급 실 DB 왕복 integration test (역할 모델 v2 티켓 03).
 *
 * 이 티켓의 핵심 약속은 하나다 — 슈퍼어드민이 만든 계정으로 **그 자리에서 로그인된다**.
 * 단위 테스트는 어떤 행을 쓰는지까지만 보고, 그 행이 Better Auth sign-in 이 실제로
 * 찾아가는 모양인지는 실 DB + 실 인스턴스로만 증명된다(issuer/provider_id/account_id
 * 규약이나 해셔가 어긋나면 계정은 생기는데 로그인만 조용히 실패한다).
 *
 * 실행 조건: DATABASE_URL 이 127.0.0.1/localhost 일 때만 (pnpm test:integration).
 */

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { accounts, sessions, users, userStatusEvents } from '@/db/schema';
import { auth } from '@/lib/auth/server';
import { DuplicateEmailError } from '@/server/auth/domain/users';
import { createUser, listUsers } from '@/server/auth/services/users';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const PASSWORD = 'initial-pw-123';
const createdUserIds: string[] = [];

/** 발급 감사 행의 changedBy 가 되는 행위자. 실제 화면에서는 로그인한 슈퍼어드민이다. */
async function seedActor(): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    name: '슈퍼어드민',
    email: `ticket03-actor-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin: true,
    userType: 'internal',
  });
  createdUserIds.push(id);
  return id;
}

function uniqueEmail(prefix: string): string {
  return `ticket03-${prefix}-${crypto.randomUUID()}@example.com`;
}

afterAll(async () => {
  if (!isLocalDb || createdUserIds.length === 0) return;
  await db.delete(userStatusEvents).where(inArray(userStatusEvents.userId, createdUserIds));
  await db.delete(userStatusEvents).where(inArray(userStatusEvents.changedBy, createdUserIds));
  await db.delete(sessions).where(inArray(sessions.userId, createdUserIds));
  await db.delete(accounts).where(inArray(accounts.userId, createdUserIds));
  await db.delete(users).where(inArray(users.id, createdUserIds));
});

describe.skipIf(!isLocalDb)('계정 직접 발급 (real local DB)', () => {
  it('내부 계정을 만들면 그 자리에서 초기 비밀번호로 로그인된다', async () => {
    const actorId = await seedActor();
    const email = uniqueEmail('internal');

    const { id } = await createUser(actorId, {
      userType: 'internal',
      name: '김새로',
      email,
      password: PASSWORD,
      jobTitle: '연구원',
    });
    createdUserIds.push(id);

    const signedIn = await auth.api.signInEmail({ body: { email, password: PASSWORD } });
    expect(signedIn.user.id).toBe(id);

    const [session] = await db.select().from(sessions).where(eq(sessions.userId, id));
    expect(session).toBeDefined();

    const row = await db.query.users.findFirst({ where: eq(users.id, id) });
    expect(row).toMatchObject({ status: 'active', userType: 'internal', jobTitle: '연구원' });
  });

  it('틀린 비밀번호로는 로그인되지 않는다', async () => {
    const actorId = await seedActor();
    const email = uniqueEmail('wrong-pw');
    const { id } = await createUser(actorId, {
      userType: 'internal',
      name: '김새로',
      email,
      password: PASSWORD,
    });
    createdUserIds.push(id);

    await expect(
      auth.api.signInEmail({ body: { email, password: `${PASSWORD}-nope` } }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
  });

  it('게스트 계정도 같은 방식으로 로그인되고 소속 기관이 남는다', async () => {
    const actorId = await seedActor();
    const email = uniqueEmail('guest');

    const { id } = await createUser(actorId, {
      userType: 'guest',
      name: '김담당',
      email,
      password: PASSWORD,
      organization: '한국물류협회',
    });
    createdUserIds.push(id);

    const signedIn = await auth.api.signInEmail({ body: { email, password: PASSWORD } });
    expect(signedIn.user.id).toBe(id);

    const row = await db.query.users.findFirst({ where: eq(users.id, id) });
    expect(row).toMatchObject({
      status: 'active',
      userType: 'guest',
      organization: '한국물류협회',
      jobTitle: null,
    });
  });

  it('발급 감사 행이 행위자와 함께 남는다', async () => {
    const actorId = await seedActor();
    const { id } = await createUser(actorId, {
      userType: 'internal',
      name: '감사확인',
      email: uniqueEmail('audit'),
      password: PASSWORD,
    });
    createdUserIds.push(id);

    const events = await db
      .select()
      .from(userStatusEvents)
      .where(eq(userStatusEvents.userId, id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ toStatus: 'active', changedBy: actorId });
  });

  it('같은 이메일은 두 번 발급되지 않는다', async () => {
    const actorId = await seedActor();
    const email = uniqueEmail('dup');
    const input = {
      userType: 'internal' as const,
      name: '김새로',
      email,
      password: PASSWORD,
    };

    const { id } = await createUser(actorId, input);
    createdUserIds.push(id);

    await expect(createUser(actorId, input)).rejects.toBeInstanceOf(DuplicateEmailError);
    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
  });

  it('목록은 유형 필터와 유형 칩 카운트를 함께 준다', async () => {
    const actorId = await seedActor();
    const { id } = await createUser(actorId, {
      userType: 'guest',
      name: '목록확인',
      email: uniqueEmail('list'),
      password: PASSWORD,
      organization: '테스트기관',
    });
    createdUserIds.push(id);

    const guests = await listUsers({ userType: 'guest', status: 'all' });
    expect(guests.items.every((item) => item.userType === 'guest')).toBe(true);
    expect(guests.items.some((item) => item.id === id)).toBe(true);
    // 칩 카운트는 유형 필터를 반영하지 않으므로 내부 계정(시드 행위자들)도 세어야 한다.
    expect(guests.typeCounts.internal).toBeGreaterThan(0);
    expect(guests.typeCounts.all).toBe(
      guests.typeCounts.internal + guests.typeCounts.guest + guests.typeCounts.fieldwork,
    );
  });
});
