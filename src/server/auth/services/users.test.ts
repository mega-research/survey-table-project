/**
 * 사용자 관리 서비스 단위 테스트 (역할 모델 v2 티켓 03).
 *
 * 겨누는 것은 두 가지다.
 *   - createUser 가 Better Auth sign-in 이 찾아갈 수 있는 계정 행을 만드는가
 *     (accounts.issuer/provider_id/account_id 규약 + 설정된 해셔로 해시된 비밀번호).
 *     이 규약이 어긋나면 계정은 생기는데 로그인만 조용히 실패한다.
 *   - listUsers 의 유형 칩 카운트가 상태 필터를 함께 반영하는가.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { accounts, userStatusEvents, users } from '@/db/schema';
import { CREDENTIAL_PROVIDER_ID, LOCAL_CREDENTIAL_ISSUER } from '@/shared/contracts/auth';

import { DuplicateEmailError } from '../domain/users';
import { createUser, listUsers } from './users';

const { hash, findFirst, findMany, groupByResult, insertCalls, insertBehavior } = vi.hoisted(
  () => ({
    hash: vi.fn(async (pw: string) => `hashed#${pw.length}`),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    groupByResult: { rows: [] as unknown[] },
    insertCalls: [] as Array<{ table: unknown; values: unknown }>,
    insertBehavior: { error: null as unknown },
  }),
);

const selectCalls: Array<{ where: unknown }> = [];

vi.mock('@/lib/auth/server', () => ({
  auth: { $context: Promise.resolve({ password: { hash } }) },
}));

vi.mock('@/db', () => {
  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertCalls.push({ table, values });
        return insertBehavior.error ? Promise.reject(insertBehavior.error) : Promise.resolve();
      },
    }),
  };
  return {
    db: {
      query: { users: { findFirst, findMany } },
      select: () => ({
        from: () => ({
          where: (where: unknown) => {
            selectCalls.push({ where });
            return { groupBy: () => Promise.resolve(groupByResult.rows) };
          },
        }),
      }),
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

const ACTOR = '11111111-1111-4111-8111-111111111111';

function inserted(table: unknown) {
  return insertCalls.find((call) => call.table === table)?.values as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  selectCalls.length = 0;
  insertBehavior.error = null;
  groupByResult.rows = [];
  findFirst.mockResolvedValue(undefined);
  findMany.mockResolvedValue([]);
});

describe('createUser', () => {
  const INTERNAL = {
    userType: 'internal' as const,
    name: '김새로',
    email: 'saero.kim@megaresearch.co.kr',
    password: 'initial-pw-12',
    jobTitle: '연구원',
  };

  it('active 내부 계정과 크리덴셜 계정을 함께 만든다', async () => {
    const res = await createUser(ACTOR, INTERNAL);

    const userRow = inserted(users);
    expect(userRow).toMatchObject({
      id: res.id,
      name: '김새로',
      email: 'saero.kim@megaresearch.co.kr',
      status: 'active',
      userType: 'internal',
      isSuperadmin: false,
      jobTitle: '연구원',
      organization: null,
    });

    const accountRow = inserted(accounts);
    expect(accountRow).toMatchObject({
      userId: res.id,
      accountId: res.id,
      providerId: CREDENTIAL_PROVIDER_ID,
      issuer: LOCAL_CREDENTIAL_ISSUER,
      password: 'hashed#13',
    });
  });

  it('비밀번호는 Better Auth 설정 해셔로만 저장한다 (평문 저장 금지)', async () => {
    await createUser(ACTOR, INTERNAL);
    expect(hash).toHaveBeenCalledWith('initial-pw-12');
    expect(JSON.stringify(insertCalls.map((call) => call.values))).not.toContain('initial-pw-12');
  });

  it('발급 감사 행을 남긴다 (행위자·사유)', async () => {
    const res = await createUser(ACTOR, INTERNAL);
    expect(inserted(userStatusEvents)).toMatchObject({
      userId: res.id,
      fromStatus: 'pending',
      toStatus: 'active',
      changedBy: ACTOR,
    });
  });

  it('게스트는 소속 기관 메모를 싣고 직책은 비운다', async () => {
    await createUser(ACTOR, {
      userType: 'guest',
      name: '김담당',
      email: 'client@klog.or.kr',
      password: 'initial-pw-12',
      organization: '한국물류협회',
    });
    expect(inserted(users)).toMatchObject({
      userType: 'guest',
      organization: '한국물류협회',
      jobTitle: null,
    });
  });

  it('이미 쓰는 이메일이면 아무것도 만들지 않는다', async () => {
    findFirst.mockResolvedValue({ id: 'existing' });
    await expect(createUser(ACTOR, INTERNAL)).rejects.toBeInstanceOf(DuplicateEmailError);
    expect(insertCalls).toHaveLength(0);
    expect(hash).not.toHaveBeenCalled();
  });

  it('동시 생성 경합의 UNIQUE 위반도 이메일 중복으로 돌려준다', async () => {
    insertBehavior.error = Object.assign(new Error('duplicate key'), { code: '23505' });
    await expect(createUser(ACTOR, INTERNAL)).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('UNIQUE 위반이 아닌 DB 오류는 삼키지 않는다', async () => {
    insertBehavior.error = Object.assign(new Error('connection reset'), { code: '08006' });
    await expect(createUser(ACTOR, INTERNAL)).rejects.toThrow('connection reset');
  });
});

describe('listUsers', () => {
  const ROW = {
    id: '22222222-2222-4222-8222-222222222222',
    name: '김새로',
    email: 'saero.kim@megaresearch.co.kr',
    userType: 'internal' as const,
    status: 'active' as const,
    isSuperadmin: false,
    jobTitle: '연구원',
    organization: null,
    createdAt: new Date('2026-08-26T00:00:00.000Z'),
  };

  it('가입일을 ISO 문자열로 직렬화해 넘긴다', async () => {
    findMany.mockResolvedValue([ROW]);
    const res = await listUsers({ userType: 'all', status: 'all' });
    expect(res.items[0]).toEqual({ ...ROW, createdAt: '2026-08-26T00:00:00.000Z' });
  });

  it('유형 칩 카운트는 결과에 없는 유형도 0 으로 채운다', async () => {
    groupByResult.rows = [
      { userType: 'internal', value: 7 },
      { userType: 'guest', value: 2 },
    ];
    const res = await listUsers({ userType: 'internal', status: 'all' });
    expect(res.typeCounts).toEqual({ all: 9, internal: 7, guest: 2, fieldwork: 0 });
  });

  it('카운트 쿼리는 상태 필터만 반영하고 유형 필터는 반영하지 않는다', async () => {
    await listUsers({ userType: 'guest', status: 'suspended' });
    // 유형 필터까지 태우면 선택하지 않은 칩이 전부 0 이 되어 칩의 목적을 잃는다.
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]?.where).toEqual(
      (await import('drizzle-orm')).eq(users.status, 'suspended'),
    );
  });
});
