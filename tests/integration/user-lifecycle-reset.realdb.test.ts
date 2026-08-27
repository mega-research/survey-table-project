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
import {
  accounts,
  sessions,
  teamLifecycleEvents,
  teamMembers,
  teams,
  userStatusEvents,
  users,
} from '@/db/schema';
import { auth } from '@/lib/auth/server';
import { UserNotFoundError, UserStatusTransitionError } from '@/server/auth/domain/users';
import { changeUserStatus, createUser, resetUserPassword } from '@/server/auth/services/users';
import { getActiveTeamMemberships } from '@/server/read-models/team-memberships';
import { RehireTeamAssignmentError, rehireUserWithTeam } from '@/server/workflows/user-rehire';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const PASSWORD = 'initial-pw-123';
const NEW_PASSWORD = 'temp-pw-4567';
const createdUserIds: string[] = [];
const createdTeamIds: string[] = [];

/** 재입사가 배정할 목적지 팀. 티켓 14 부터 내부 일반 계정의 재입사는 팀 없이 성립하지 않는다. */
async function seedTeam(): Promise<string> {
  const [team] = await db
    .insert(teams)
    .values({ name: `재입사팀-${crypto.randomUUID().slice(0, 8)}` })
    .returning({ id: teams.id });
  createdTeamIds.push(team!.id);
  return team!.id;
}

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
  // 팀 쪽 행이 users 를 FK RESTRICT 로 잡고 있어 사용자보다 먼저 지운다.
  if (createdTeamIds.length > 0) {
    await db.delete(teamLifecycleEvents).where(inArray(teamLifecycleEvents.teamId, createdTeamIds));
    await db.delete(teamMembers).where(inArray(teamMembers.teamId, createdTeamIds));
  }
  await db.delete(users).where(inArray(users.id, createdUserIds));
  if (createdTeamIds.length > 0) {
    await db.delete(teams).where(inArray(teams.id, createdTeamIds));
  }
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

    // 재입사는 상태 전이와 팀 배정을 한 트랜잭션으로 묶는다(티켓 14).
    const teamId = await seedTeam();
    await rehireUserWithTeam(
      { id: actorId, isSuperadmin: true },
      {
        action: 'rehire',
        userId: id,
        password: NEW_PASSWORD,
        jobTitle: '선임연구원',
        teamId,
        teamRole: 'member',
      },
    );

    expect(await statusOf(id)).toBe('active');
    // 팀 배정까지 이어진다 — 상태만 되돌리면 로그인만 되는 미배치로 되살아난다.
    expect(await getActiveTeamMemberships(id)).toMatchObject([{ teamId, role: 'member' }]);
    const signedIn = await signIn(email, NEW_PASSWORD);
    expect(signedIn.user.id).toBe(id);
    // 재입사는 비밀번호 재설정을 겸한다 — 퇴사 전 비밀번호는 더 이상 통하지 않는다.
    await expect(signIn(email, PASSWORD)).rejects.toMatchObject({ status: 'UNAUTHORIZED' });

    const row = await db.query.users.findFirst({ where: eq(users.id, id) });
    expect(row).toMatchObject({ jobTitle: '선임연구원' });
  });

  it('팀이 있던 사람도 재입사한다 — 옛 소속을 끊고 새 소속을 앉힌다', async () => {
    // **퇴사는 멤버십 행을 지우지 않는다**(팀 상세가 비활성 멤버를 표식과 함께 보여줘야 하므로).
    // 정리 단계가 없으면 「이미 다른 팀에 소속됨」으로 막혀 팀이 있던 사람은 아무도 재입사할
    // 수 없다 — 실제로 그게 정상 동선이라 이 테스트가 없으면 기능 전체가 죽은 채로 초록이다.
    const actorId = await seedActor();
    const { id } = await seedUser(actorId, '옛소속');
    const oldTeam = await seedTeam();
    const newTeam = await seedTeam();
    await db.insert(teamMembers).values({ teamId: oldTeam, userId: id, role: 'leader' });

    await changeUserStatus(actorId, { action: 'depart', userId: id });
    // 퇴사해도 행은 남는다 — 이 사실이 위 정리 단계의 전제다.
    expect(await getActiveTeamMemberships(id)).toHaveLength(1);

    await rehireUserWithTeam(
      { id: actorId, isSuperadmin: true },
      {
        action: 'rehire',
        userId: id,
        password: NEW_PASSWORD,
        teamId: newTeam,
        teamRole: 'member',
      },
    );

    // 옛 팀은 끊기고 새 팀만 남는다(.pen 9-4 「이전 팀 멤버십은 자동 복구하지 않습니다」).
    expect(await getActiveTeamMemberships(id)).toMatchObject([{ teamId: newTeam, role: 'member' }]);

    // 누가 언제 뺐는지는 감사 행에만 남는다 — 멤버 행을 지우기 때문이다.
    const events = await db
      .select({ action: teamLifecycleEvents.action, teamId: teamLifecycleEvents.teamId })
      .from(teamLifecycleEvents)
      .where(eq(teamLifecycleEvents.targetUserId, id));
    expect(events).toEqual(
      expect.arrayContaining([
        { action: 'member_remove', teamId: oldTeam },
        { action: 'member_add', teamId: newTeam },
      ]),
    );
  });

  it('유일한 팀장이었어도 재입사가 막히지 않는다', async () => {
    // 마지막 팀장 가드가 세는 것은 **활성** 팀장이고 이 시점의 대상은 이미 퇴사 상태다.
    // 정리 단계가 그 가드를 부르면 "활성 팀장 0명" 인 팀에서 재입사가 영구히 막힌다.
    const actorId = await seedActor();
    const { id } = await seedUser(actorId, '유일팀장');
    const oldTeam = await seedTeam();
    const newTeam = await seedTeam();
    await db.insert(teamMembers).values({ teamId: oldTeam, userId: id, role: 'leader' });

    await changeUserStatus(actorId, { action: 'depart', userId: id });
    await rehireUserWithTeam(
      { id: actorId, isSuperadmin: true },
      { action: 'rehire', userId: id, password: NEW_PASSWORD, teamId: newTeam, teamRole: 'leader' },
    );

    expect(await getActiveTeamMemberships(id)).toMatchObject([{ teamId: newTeam, role: 'leader' }]);
  });

  it('팀에 소속될 수 없는 계정은 팀 없이 재입사한다', async () => {
    // guest·fieldwork 는 멤버십 자체가 금지고(스펙 §1) 슈퍼어드민은 팀 소속과 무관하다.
    // 팀을 요구하면 그 계정들은 한 번 퇴사한 뒤 영영 돌아올 수 없다.
    const actorId = await seedActor();
    const guestId = crypto.randomUUID();
    await db.insert(users).values({
      id: guestId,
      name: '게스트',
      email: `ticket04-guest-${guestId}@example.com`,
      emailVerified: true,
      status: 'active',
      isSuperadmin: false,
      userType: 'guest',
    });
    createdUserIds.push(guestId);

    await changeUserStatus(actorId, { action: 'depart', userId: guestId });
    await rehireUserWithTeam(
      { id: actorId, isSuperadmin: true },
      { action: 'rehire', userId: guestId, password: NEW_PASSWORD, teamId: null, teamRole: null },
    );

    expect(await statusOf(guestId)).toBe('active');
    expect(await getActiveTeamMemberships(guestId)).toHaveLength(0);
  });

  it('팀에 소속될 수 없는 계정에 팀을 보내면 거부하고 전부 롤백한다', async () => {
    const actorId = await seedActor();
    const guestId = crypto.randomUUID();
    await db.insert(users).values({
      id: guestId,
      name: '게스트2',
      email: `ticket04-guest2-${guestId}@example.com`,
      emailVerified: true,
      status: 'active',
      isSuperadmin: false,
      userType: 'guest',
    });
    createdUserIds.push(guestId);
    await changeUserStatus(actorId, { action: 'depart', userId: guestId });

    await expect(
      rehireUserWithTeam(
        { id: actorId, isSuperadmin: true },
        {
          action: 'rehire',
          userId: guestId,
          password: NEW_PASSWORD,
          teamId: await seedTeam(),
          teamRole: 'member',
        },
      ),
    ).rejects.toBeInstanceOf(RehireTeamAssignmentError);

    // 계정은 여전히 퇴사 상태다 — 상태만 살아나는 창이 없다는 것이 이 흐름의 계약이다.
    expect(await statusOf(guestId)).toBe('departed');
  });

  it('내부 일반 계정에 팀이 없으면 거부하고 전부 롤백한다', async () => {
    const actorId = await seedActor();
    const { id } = await seedUser(actorId, '팀누락');
    await changeUserStatus(actorId, { action: 'depart', userId: id });

    await expect(
      rehireUserWithTeam(
        { id: actorId, isSuperadmin: true },
        { action: 'rehire', userId: id, password: NEW_PASSWORD, teamId: null, teamRole: null },
      ),
    ).rejects.toBeInstanceOf(RehireTeamAssignmentError);

    expect(await statusOf(id)).toBe('departed');
  });

  it('모든 전이가 감사 행을 남긴다', async () => {
    const actorId = await seedActor();
    const { id } = await seedUser(actorId, 'audit');

    await changeUserStatus(actorId, { action: 'suspend', userId: id });
    await changeUserStatus(actorId, { action: 'depart', userId: id });
    await rehireUserWithTeam(
      { id: actorId, isSuperadmin: true },
      {
        action: 'rehire',
        userId: id,
        password: NEW_PASSWORD,
        teamId: await seedTeam(),
        teamRole: 'member',
      },
    );

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
