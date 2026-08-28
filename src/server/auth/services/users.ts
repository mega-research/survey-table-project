import 'server-only';

import { type SQL, and, asc, count, eq, sql } from 'drizzle-orm';

import { type DbTransaction as Tx, db } from '@/db';
import { accounts, sessions, userStatusEvents, users } from '@/db/schema';
import { auth } from '@/lib/auth/server';
import { isUniqueViolation } from '@/lib/pg-error';
import {
  CREDENTIAL_PROVIDER_ID,
  LOCAL_CREDENTIAL_ISSUER,
  type UserStatusAction,
  type UserType,
} from '@/shared/contracts/auth';

import {
  PASSWORD_RESET_REASON,
  USER_STATUS_ACTION_REASON,
  leavesActiveStatus,
  resolveUserStatusTransition,
} from '../domain/user-status-transition';
import { DuplicateEmailError, UserNotFoundError } from '../domain/users';
import type {
  ChangeUserStatusInput,
  ChangeUserStatusOutput,
  CreateUserInput,
  CreateUserOutput,
  ListUsersInput,
  ListUsersOutput,
  ResetUserPasswordInput,
  ResetUserPasswordOutput,
} from '../domain/users';

/** 목록/카운트 공용 — 'all' 이면 좁히지 않는다(undefined 는 drizzle 이 무시한다). */
function statusFilter(status: ListUsersInput['status']): SQL | undefined {
  return status === 'all' ? undefined : eq(users.status, status);
}

/**
 * 사용자 목록 + 유형 칩 카운트 — 가입순.
 *
 * 카운트는 상태 필터만 태운다(auth-io 의 ListUsersOutput 주석 참조). 두 쿼리가 같은
 * 상태 조건을 보게 statusFilter 하나로 만든다 — 어긋나면 칩 합계와 표 건수가 갈린다.
 */
export async function listUsers(input: ListUsersInput): Promise<ListUsersOutput> {
  const byStatus = statusFilter(input.status);
  const byType = input.userType === 'all' ? undefined : eq(users.userType, input.userType);

  const rows = await db.query.users.findMany({
    where: and(byStatus, byType),
    orderBy: [asc(users.createdAt)],
    columns: {
      id: true,
      name: true,
      email: true,
      userType: true,
      status: true,
      isSuperadmin: true,
      jobTitle: true,
      organization: true,
      createdAt: true,
    },
  });

  const countRows = await db
    .select({ userType: users.userType, value: count() })
    .from(users)
    .where(byStatus)
    .groupBy(users.userType);

  const typeCounts = { all: 0, internal: 0, guest: 0, fieldwork: 0 };
  for (const row of countRows) {
    typeCounts[row.userType] += row.value;
    typeCounts.all += row.value;
  }

  return {
    items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    typeCounts,
  };
}

/**
 * 계정 직접 발급 (ADR-0018) — 생성 즉시 active 라 그 자리에서 로그인할 수 있다.
 *
 * 승인 단계도 안내 메일도 없다. 초기 비밀번호는 슈퍼어드민이 정해 사내 채널로 전달하고
 * 본인이 프로필에서 바꾼다.
 *
 * 계정 행(accounts)의 issuer/provider_id/account_id 는 Better Auth 1.7 의 크리덴셜 규약값과
 * 정확히 같아야 한다 — 어긋나면 sign-in 의 계정 조회가 조용히 실패해 "계정은 있는데
 * 로그인만 안 되는" 상태가 된다. 해시는 인스턴스 설정 해셔(auth.$context)를 그대로 쓴다.
 */
export async function createUser(
  actorUserId: string,
  input: CreateUserInput,
): Promise<CreateUserOutput> {
  // 선검사는 UI 문구를 위한 것이고, 동시 생성 경합은 아래 UNIQUE 위반이 잡는다.
  //
  // 대소문자를 접어서 본다. 입력은 경계(zod)에서 이미 소문자지만 users.email UNIQUE 는
  // case-sensitive 라, 대문자가 섞인 옛 행(Supabase Auth 시절 이관분)이 있으면 선검사도
  // UNIQUE 도 통과해 같은 사람의 계정이 둘 생긴다 — 그러면 로그인은 소문자 행으로만 간다.
  const existing = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${input.email}`,
    columns: { id: true },
  });
  if (existing) throw new DuplicateEmailError();

  const passwordHash = await hashPassword(input.password);

  const id = crypto.randomUUID();
  const now = new Date();
  const userType: UserType = input.userType;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id,
        name: input.name,
        email: input.email,
        // 이메일 확인 절차가 없는 직접 발급이다 — 확인 대기 상태로 두면 로그인이 막힌다.
        emailVerified: true,
        status: 'active',
        isSuperadmin: false,
        userType,
        jobTitle: input.userType === 'internal' ? (input.jobTitle ?? null) : null,
        organization: input.userType === 'guest' ? (input.organization ?? null) : null,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(accounts).values({
        id: crypto.randomUUID(),
        userId: id,
        accountId: id,
        providerId: CREDENTIAL_PROVIDER_ID,
        issuer: LOCAL_CREDENTIAL_ISSUER,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });
      // 발급도 감사 대상이다 — 누가 이 계정을 만들었는지는 여기 말고 남는 곳이 없다.
      // from_status 는 컬럼 기본값 'pending': users 행이 그 값을 가진 적은 없지만
      // (v2 는 항상 명시적 active 발급) 감사 계보에서 '발급 이전'을 가리키는 유일한 어휘다.
      await tx.insert(userStatusEvents).values({
        id: crypto.randomUUID(),
        userId: id,
        fromStatus: 'pending',
        toStatus: 'active',
        changedBy: actorUserId,
        reason: '슈퍼어드민 직접 발급',
        createdAt: now,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateEmailError();
    throw err;
  }

  return { id };
}

// ─────────────────────────────────────────────────────────────────────────────
// 계정 수명주기 — 상태 전이 · 비밀번호 재설정 (티켓 04)
// ─────────────────────────────────────────────────────────────────────────────

/** 인스턴스 설정 해셔를 그대로 쓴다 — 발급·재설정·재입사가 같은 알고리즘으로 해시해야 한다. */
export async function hashPassword(plain: string): Promise<string> {
  const authContext = await auth.$context;
  return authContext.password.hash(plain);
}

/**
 * 크리덴셜 계정의 비밀번호 해시를 갈아끼운다.
 *
 * 행이 없으면 만든다 — Better Auth 이전에 이관된 행처럼 크리덴셜 계정이 아예 없는 사용자가
 * 있을 수 있고, 그 경우 UPDATE 는 0행을 고치고 조용히 끝나 "재설정했다는데 로그인은 안 되는"
 * 상태가 된다. 규약값(providerId·issuer·accountId)은 발급 경로와 같은 상수를 쓴다.
 */
async function writeCredentialPassword(
  tx: Tx,
  userId: string,
  passwordHash: string,
  now: Date,
): Promise<void> {
  const updated = await tx
    .update(accounts)
    .set({ password: passwordHash, updatedAt: now })
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, CREDENTIAL_PROVIDER_ID),
        eq(accounts.issuer, LOCAL_CREDENTIAL_ISSUER),
      ),
    )
    .returning({ id: accounts.id });
  if (updated.length > 0) return;

  await tx.insert(accounts).values({
    id: crypto.randomUUID(),
    userId,
    accountId: userId,
    providerId: CREDENTIAL_PROVIDER_ID,
    issuer: LOCAL_CREDENTIAL_ISSUER,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * 이 전이로 active 슈퍼어드민이 0명이 되는가.
 *
 * 대상이 지금 active 가 아니면(이미 정지된 슈퍼어드민의 퇴사) 이 전이는 active 인원을
 * 줄이지 않으므로 카운트 쿼리를 돌지 않고 false 다 — 워크트리 Plan2 Task 5 에서 이 조건을
 * 빠뜨려 정지된 슈퍼어드민의 퇴사가 오차단됐다.
 */
async function isLastActiveSuperadmin(
  tx: Tx,
  target: { isSuperadmin: boolean; status: (typeof users.$inferSelect)['status'] },
  action: UserStatusAction,
): Promise<boolean> {
  if (!leavesActiveStatus(action)) return false;
  if (!target.isSuperadmin || target.status !== 'active') return false;

  const [row] = await tx
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.isSuperadmin, true), eq(users.status, 'active')));
  return (row?.value ?? 0) <= 1;
}

/**
 * 대상 계정의 모든 세션을 끊는다 — 전이·재설정이 공유하는 마무리.
 *
 * 지우는 것만으로는 부족하다. 이미 옛 해시를 읽어둔 로그인이 이 트랜잭션 **뒤에** 세션을
 * 만들 수 있기 때문이다. 그래서 폐기 시각을 표식으로 남긴다 — 로그인 흐름이 시작 시점의
 * 값과 대조해 자기가 낡았음을 알아채고 세션 생성을 취소한다(lib/auth/session-revocation).
 */
async function revokeSessions(tx: Tx, userId: string, now: Date): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx.update(users).set({ sessionsRevokedAt: now }).where(eq(users.id, userId));
}

/**
 * 계정 상태 전이 — 일시 정지 / 재직 복귀 / 퇴사 / 재입사.
 *
 * 한 트랜잭션 안에서 행 잠금 → 전이 검증 → 세션 폐기 → 감사 기록을 마친다. 앞의 advisory
 * lock 은 전이를 직렬화한다 — 마지막 남은 슈퍼어드민 둘을 동시에 정지시키려는 경합에서
 * 각자 "다른 active 가 1명 있다"고 읽으면 둘 다 통과해 슈퍼어드민이 0명이 된다.
 *
 * 이 함수가 보장하는 것은 **상태·세션·감사**뿐이다. 재입사의 팀 배정은 워크스페이스 도메인의
 * 쓰기라 여기서 부를 수 없어(도메인 간 직접 import 금지) server/workflows/user-rehire 가
 * 같은 트랜잭션으로 묶는다 — 그 층이 applyUserStatusChange 를 직접 쓰는 이유다.
 * **소유권 정리는 워크플로가 진다**(user-departure, 티켓 19) — 이 함수는 상태·세션·감사만
 * 다룬다. 멤버십 행은 **일부러 지우지 않는다**: 팀 상세가 비활성 멤버를 표식과 함께 계속
 * 보여줘야 하고, 유효 소속 판정(getActiveTeamMemberships)이 아니라 계정 상태가 접근을 막는다.
 */
export async function changeUserStatus(
  actorUserId: string,
  input: ChangeUserStatusInput,
): Promise<ChangeUserStatusOutput> {
  // 해시는 느리다. 트랜잭션(과 advisory lock) 밖에서 미리 만들어 잠금 구간을 짧게 둔다.
  const passwordHash = input.action === 'rehire' ? await hashPassword(input.password) : null;
  return db.transaction((tx) => applyUserStatusChange(tx, actorUserId, input, passwordHash));
}

/**
 * 상태 전이의 트랜잭션 본문 — 호출측이 트랜잭션을 소유한다.
 *
 * 재입사는 팀 배정과 **한 트랜잭션**이어야 한다. 갈라 두면 상태만 active 로 바뀌고 배정이
 * 실패하는 창이 생겨, 「새 소속으로 다시 시작」한다던 사람이 미배치로 되살아난다.
 * 비밀번호 해시는 느려서 잠금 구간 밖에서 만들어 넘긴다.
 */
export async function applyUserStatusChange(
  tx: Tx,
  actorUserId: string,
  input: ChangeUserStatusInput,
  passwordHash: string | null,
): Promise<ChangeUserStatusOutput> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('user-status-transition')::bigint)`);

  const [target] = await tx
    .select({
      id: users.id,
      status: users.status,
      isSuperadmin: users.isSuperadmin,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .for('update');
  if (!target) throw new UserNotFoundError();

  const nextStatus = resolveUserStatusTransition(
    target.status,
    input.action,
    await isLastActiveSuperadmin(tx, target, input.action),
  );
  const now = new Date();

  if (input.action === 'rehire' && passwordHash) {
    await writeCredentialPassword(tx, input.userId, passwordHash, now);
  }

  await tx
    .update(users)
    .set({
      status: nextStatus,
      updatedAt: now,
      // 재입사 모달은 현재 직책을 채워 보여주므로 보낸 값이 곧 저장될 값이다 — 비우면
      // 지운다. 다른 전이는 직책을 건드리지 않는다.
      ...(input.action === 'rehire' ? { jobTitle: input.jobTitle ?? null } : {}),
    })
    .where(eq(users.id, input.userId));

  // Better Auth sign-in 훅의 비활성 차단이 1차 방어다. 잔존 세션도 항상 끊어 재직 복귀를
  // 포함한 모든 전이가 깨끗한 로그인에서 시작되게 한다.
  await revokeSessions(tx, input.userId, now);

  await tx.insert(userStatusEvents).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    fromStatus: target.status,
    toStatus: nextStatus,
    changedBy: actorUserId,
    reason: USER_STATUS_ACTION_REASON[input.action],
    createdAt: now,
  });

  return { status: nextStatus };
}

/**
 * 비밀번호 재설정 — 슈퍼어드민이 새 임시 비밀번호를 직접 정한다 (.pen FLOW 1-3).
 *
 * 이메일 재설정 링크는 없다(ADR-0018). 저장과 동시에 대상의 모든 세션을 폐기한다 —
 * 재설정하는 이유가 대개 분실·유출이라 남겨두면 목적을 잃는다.
 *
 * 상태는 바뀌지 않지만 감사 행은 남긴다(from=to). 비밀번호 교체는 계정 수명주기의 사건이고,
 * 남길 곳이 user_status_events 말고 없다.
 */
export async function resetUserPassword(
  actorUserId: string,
  input: ResetUserPasswordInput,
): Promise<ResetUserPasswordOutput> {
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, input.userId))
      .for('update');
    if (!target) throw new UserNotFoundError();

    const now = new Date();
    await writeCredentialPassword(tx, input.userId, passwordHash, now);
    await revokeSessions(tx, input.userId, now);

    await tx.insert(userStatusEvents).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      fromStatus: target.status,
      toStatus: target.status,
      changedBy: actorUserId,
      reason: PASSWORD_RESET_REASON,
      createdAt: now,
    });

    return { success: true };
  });
}
