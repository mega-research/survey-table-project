import 'server-only';

import { type SQL, and, asc, count, eq } from 'drizzle-orm';

import { db } from '@/db';
import { accounts, userStatusEvents, users } from '@/db/schema';
import { auth } from '@/lib/auth/server';
import { isUniqueViolation } from '@/lib/pg-error';
import {
  CREDENTIAL_PROVIDER_ID,
  LOCAL_CREDENTIAL_ISSUER,
  type UserType,
} from '@/shared/contracts/auth';

import { DuplicateEmailError } from '../domain/users';
import type {
  CreateUserInput,
  CreateUserOutput,
  ListUsersInput,
  ListUsersOutput,
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
  const existing = await db.query.users.findFirst({
    where: eq(users.email, input.email),
    columns: { id: true },
  });
  if (existing) throw new DuplicateEmailError();

  const authContext = await auth.$context;
  const passwordHash = await authContext.password.hash(input.password);

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
