/**
 * 계정 수명주기·비밀번호 재설정 실 DB 왕복 integration test (역할 모델 v2 티켓 04).
 *
 * 단위 테스트는 "어떤 행을 쓰는가"까지만 본다. 이 티켓의 약속은 그 행이 Better Auth 의
 * 로그인 판정을 실제로 바꾸는가에 있다 — 재설정한 임시 비밀번호로 들어와지고 옛 비밀번호는
 * 막히는가, 정지·퇴사 계정이 미존재 계정과 같은 문구로 거부되는가, 세션이 정말 끊기는가.
 * 해셔나 계정 규약이 어긋나면 행은 멀쩡한데 로그인만 조용히 갈린다.
 *
 * 마지막 active 슈퍼어드민 가드의 **거부 쪽**은 여기서 보지 않는다 — 카운트가 DB 전역이라
 * 그 상황을 만들려면 다른 테스트 파일이 심은 슈퍼어드민까지 내려야 하고, 파일이 병렬로 도는
 * 이상 남의 상태를 건드리게 된다. 거부 판정은 서비스 단위 테스트(users.test.ts)가 덮고,
 * 여기서는 "마지막이 아니면 통과한다"는 반대편만 실 DB 로 확인한다.
 *
 * 실행 조건: DATABASE_URL 이 127.0.0.1/localhost 일 때만 (pnpm test:integration).
 */

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { accounts, sessions, userStatusEvents, users } from '@/db/schema';
import { auth } from '@/lib/auth/server';
import { UserNotFoundError, UserStatusTransitionError } from '@/server/auth/domain/users';
import { changeUserStatus, createUser, resetUserPassword } from '@/server/auth/services/users';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const PASSWORD = 'initial-pw-123';
const NEW_PASSWORD = 'temp-pw-4567';
const createdUserIds: string[] = [];

async function seedActor(): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    name: '슈퍼어드민',
    email: `ticket04-actor-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin: true,
    userType: 'internal',
  });
  createdUserIds.push(id);
  return id;
}

/** 발급 경로 그대로 계정을 만든다 — 재설정이 고칠 행도 그 경로가 만든 것이어야 한다. */
async function seedUser(actorId: string, prefix: string): Promise<{ id: string; email: string }> {
  const email = `ticket04-${prefix}-${crypto.randomUUID()}@example.com`;
  const { id } = await createUser(actorId, {
    userType: 'internal',
    name: '김새로',
    email,
    password: PASSWORD,
  });
  createdUserIds.push(id);
  return { id, email };
}

async function signIn(email: string, password: string) {
  return auth.api.signInEmail({ body: { email, password } });
}

/** 로그인 실패 응답 전체 — 미존재 계정과 status·body 까지 같아야 한다(이메일 존재 오라클 금지). */
async function signInFailure(email: string, password: string) {
  try {
    await signIn(email, password);
    return null;
  } catch (err) {
    const apiError = err as { status: unknown; body: unknown };
    return { status: apiError.status, body: apiError.body };
  }
}

async function statusOf(id: string) {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  return row?.status;
}

async function sessionCount(id: string) {
  const rows = await db.select().from(sessions).where(eq(sessions.userId, id));
  return rows.length;
}

afterAll(async () => {
  if (!isLocalDb || createdUserIds.length === 0) return;
  await db.delete(userStatusEvents).where(inArray(userStatusEvents.userId, createdUserIds));
  await db.delete(userStatusEvents).where(inArray(userStatusEvents.changedBy, createdUserIds));
  await db.delete(sessions).where(inArray(sessions.userId, createdUserIds));
  await db.delete(accounts).where(inArray(accounts.userId, createdUserIds));
  await db.delete(users).where(inArray(users.id, createdUserIds));
});

describe.skipIf(!isLocalDb)('비밀번호 재설정 (real local DB)', () => {
  it('재설정한 임시 비밀번호로 로그인되고 이전 비밀번호는 막힌다', async () => {
    const actorId = await seedActor();
    const { id, email } = await seedUser(actorId, 'reset');
    await signIn(email, PASSWORD);
    expect(await sessionCount(id)).toBeGreaterThan(0);

    await resetUserPassword(actorId, { userId: id, password: NEW_PASSWORD });

    // 저장 즉시 이 계정의 모든 세션이 폐기된다 (.pen FLOW 1-3 의 경고 문구가 곧 계약이다).
    expect(await sessionCount(id)).toBe(0);

    const signedIn = await signIn(email, NEW_PASSWORD);
    expect(signedIn.user.id).toBe(id);
    await expect(signIn(email, PASSWORD)).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
  });

  it('재설정은 상태를 바꾸지 않고 from=to 감사 행을 남긴다', async () => {
    const actorId = await seedActor();
    const { id } = await seedUser(actorId, 'reset-audit');

    await resetUserPassword(actorId, { userId: id, password: NEW_PASSWORD });

    expect(await statusOf(id)).toBe('active');
    const events = await db
      .select()
      .from(userStatusEvents)
      .where(eq(userStatusEvents.userId, id));
    // 발급 1건 + 재설정 1건.
    expect(events).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({
      fromStatus: 'active',
      toStatus: 'active',
      changedBy: actorId,
      reason: '슈퍼어드민 비밀번호 재설정',
    });
  });

  it('없는 사용자의 재설정은 거부된다', async () => {
    const actorId = await seedActor();
    await expect(
      resetUserPassword(actorId, { userId: crypto.randomUUID(), password: NEW_PASSWORD }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

describe.skipIf(!isLocalDb)('계정 상태 전이 (real local DB)', () => {
  it('일시 정지하면 세션이 끊기고 로그인이 막힌다', async () => {
    const actorId = await seedActor();
    const { id, email } = await seedUser(actorId, 'suspend');
    await signIn(email, PASSWORD);

    await changeUserStatus(actorId, { action: 'suspend', userId: id });

    expect(await statusOf(id)).toBe('suspended');
    expect(await sessionCount(id)).toBe(0);
    await expect(signIn(email, PASSWORD)).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
  });

  it('재직 복귀하면 같은 비밀번호로 다시 들어온다', async () => {
    const actorId = await seedActor();
    const { id, email } = await seedUser(actorId, 'resume');
    await changeUserStatus(actorId, { action: 'suspend', userId: id });

    await changeUserStatus(actorId, { action: 'resume', userId: id });

    expect(await statusOf(id)).toBe('active');
    const signedIn = await signIn(email, PASSWORD);
    expect(signedIn.user.id).toBe(id);
  });

  it('정지·퇴사 계정의 로그인 실패 응답은 미존재 계정과 구분되지 않는다', async () => {
    const actorId = await seedActor();
    const suspended = await seedUser(actorId, 'blocked-suspended');
    const departed = await seedUser(actorId, 'blocked-departed');
    await changeUserStatus(actorId, { action: 'suspend', userId: suspended.id });
    await changeUserStatus(actorId, { action: 'depart', userId: departed.id });

    const missing = await signInFailure(`ticket04-missing-${crypto.randomUUID()}@example.com`, PASSWORD);
    expect(missing).not.toBeNull();
    expect(await signInFailure(suspended.email, PASSWORD)).toEqual(missing);
    expect(await signInFailure(departed.email, PASSWORD)).toEqual(missing);
  });

  it('공백이 섞인 이메일로도 비활성 계정을 식별할 수 없다', async () => {
    // 훅은 trim 한 값으로 조회하는데 Better Auth 는 원본에 z.email() 을 건다. 훅이 그 차이를
    // 무시하면 비활성 계정만 401 이 되고 나머지는 400 이 되어 계정 상태가 응답 코드로 샌다.
    const actorId = await seedActor();
    const suspended = await seedUser(actorId, 'padded-suspended');
    await changeUserStatus(actorId, { action: 'suspend', userId: suspended.id });
    const active = await seedUser(actorId, 'padded-active');

    const pad = (email: string) => ` ${email} `;
    const missing = await signInFailure(pad(`ticket04-none-${crypto.randomUUID()}@example.com`), PASSWORD);
    expect(missing).not.toBeNull();
    expect(await signInFailure(pad(suspended.email), PASSWORD)).toEqual(missing);
    expect(await signInFailure(pad(active.email), PASSWORD)).toEqual(missing);
  });

  it('퇴사자는 재직 복귀가 아니라 재입사로만 돌아온다', async () => {
    const actorId = await seedActor();
    const { id, email } = await seedUser(actorId, 'rehire');
    await changeUserStatus(actorId, { action: 'depart', userId: id });

    await expect(
      changeUserStatus(actorId, { action: 'resume', userId: id }),
    ).rejects.toBeInstanceOf(UserStatusTransitionError);
    expect(await statusOf(id)).toBe('departed');

    await changeUserStatus(actorId, {
      action: 'rehire',
      userId: id,
      password: NEW_PASSWORD,
      jobTitle: '선임연구원',
    });

    expect(await statusOf(id)).toBe('active');
    const signedIn = await signIn(email, NEW_PASSWORD);
    expect(signedIn.user.id).toBe(id);
    // 재입사는 비밀번호 재설정을 겸한다 — 퇴사 전 비밀번호는 더 이상 통하지 않는다.
    await expect(signIn(email, PASSWORD)).rejects.toMatchObject({ status: 'UNAUTHORIZED' });

    const row = await db.query.users.findFirst({ where: eq(users.id, id) });
    expect(row).toMatchObject({ jobTitle: '선임연구원' });
  });

  it('모든 전이가 감사 행을 남긴다', async () => {
    const actorId = await seedActor();
    const { id } = await seedUser(actorId, 'audit');

    await changeUserStatus(actorId, { action: 'suspend', userId: id });
    await changeUserStatus(actorId, { action: 'depart', userId: id });
    await changeUserStatus(actorId, { action: 'rehire', userId: id, password: NEW_PASSWORD });

    const events = await db
      .select()
      .from(userStatusEvents)
      .where(eq(userStatusEvents.userId, id));
    // 발급 + 전이 3건.
    expect(events).toHaveLength(4);
    expect(events.map((e) => `${e.fromStatus}>${e.toStatus}`)).toEqual([
      'pending>active',
      'active>suspended',
      'suspended>departed',
      'departed>active',
    ]);
    expect(events.every((e) => e.changedBy === actorId)).toBe(true);
  });

  it('마지막 active 슈퍼어드민이 아니면 정지할 수 있다', async () => {
    // 시드 행위자들이 이미 여럿 active 슈퍼어드민이라 이 계정은 마지막이 아니다.
    const actorId = await seedActor();
    const other = await seedActor();

    await expect(
      changeUserStatus(actorId, { action: 'suspend', userId: other }),
    ).resolves.toEqual({ status: 'suspended' });
  });

});
