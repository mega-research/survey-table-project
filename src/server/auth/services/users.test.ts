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

import { accounts, sessions, userStatusEvents, users } from '@/db/schema';
import { CREDENTIAL_PROVIDER_ID, LOCAL_CREDENTIAL_ISSUER } from '@/shared/contracts/auth';

import {
  DuplicateEmailError,
  LastActiveSuperadminError,
  UserNotFoundError,
  UserStatusTransitionError,
} from '../domain/users';
import { changeUserStatus, createUser, listUsers, resetUserPassword } from './users';

const { hash, findFirst, findMany, groupByResult, insertCalls, insertBehavior, txState } =
  vi.hoisted(() => ({
    hash: vi.fn(async (pw: string) => `hashed#${pw.length}`),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    groupByResult: { rows: [] as unknown[] },
    insertCalls: [] as Array<{ table: unknown; values: unknown }>,
    insertBehavior: { error: null as unknown },
    // 트랜잭션 안에서 읽는 값들 — 대상 행, active 슈퍼어드민 수, 크리덴셜 UPDATE 가
    // 고친 행. 테스트마다 이 셋만 갈아끼우면 분기를 전부 만들 수 있다.
    txState: {
      targetRows: [] as unknown[],
      activeSuperadmins: 0,
      credentialUpdateRows: [{ id: 'account-row' }] as unknown[],
    },
  }));

const selectCalls: Array<{ where: unknown }> = [];
const updateCalls: Array<{ table: unknown; values: unknown }> = [];
const deleteCalls: Array<{ table: unknown }> = [];

vi.mock('@/lib/auth/server', () => ({
  auth: { $context: Promise.resolve({ password: { hash } }) },
}));

vi.mock('@/db', () => {
  // where() 결과는 두 가지로 쓰인다 — .for('update') 로 대상 행을 잠그거나, 그대로 await 해서
  // 카운트를 읽거나. 한 객체가 둘 다 답하도록 thenable 로 만든다.
  function whereResult() {
    const counted = Promise.resolve([{ value: txState.activeSuperadmins }]);
    return {
      for: () => Promise.resolve(txState.targetRows),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        counted.then(resolve, reject),
    };
  }

  const tx = {
    execute: () => Promise.resolve(),
    select: () => ({ from: () => ({ where: () => whereResult() }) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertCalls.push({ table, values });
        return insertBehavior.error ? Promise.reject(insertBehavior.error) : Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          updateCalls.push({ table, values });
          return {
            returning: () => Promise.resolve(txState.credentialUpdateRows),
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(undefined).then(resolve, reject),
          };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        deleteCalls.push({ table });
        return Promise.resolve();
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
  updateCalls.length = 0;
  deleteCalls.length = 0;
  insertBehavior.error = null;
  txState.targetRows = [];
  txState.activeSuperadmins = 0;
  txState.credentialUpdateRows = [{ id: 'account-row' }];
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

const TARGET = '33333333-3333-4333-8333-333333333333';

/** 대상 행 세팅 — 잠긴 users 행이 이 모양으로 돌아온다. */
function target(row: { status: string; isSuperadmin?: boolean }) {
  txState.targetRows = [{ id: TARGET, isSuperadmin: false, ...row }];
}

function updatedValues(table: unknown) {
  return updateCalls.find((call) => call.table === table)?.values as Record<string, unknown>;
}

function deletedTables() {
  return deleteCalls.map((call) => call.table);
}

describe('changeUserStatus', () => {
  it('일시 정지는 상태를 바꾸고 세션을 끊고 감사 행을 남긴다', async () => {
    target({ status: 'active' });

    const res = await changeUserStatus(ACTOR, { action: 'suspend', userId: TARGET });

    expect(res).toEqual({ status: 'suspended' });
    expect(updatedValues(users)).toMatchObject({ status: 'suspended' });
    expect(deletedTables()).toContain(sessions);
    expect(inserted(userStatusEvents)).toMatchObject({
      userId: TARGET,
      fromStatus: 'active',
      toStatus: 'suspended',
      changedBy: ACTOR,
      reason: '슈퍼어드민 일시 정지',
    });
  });

  it('재직 복귀도 세션을 끊는다 (전이는 모두 깨끗한 로그인에서 시작한다)', async () => {
    target({ status: 'suspended' });
    await changeUserStatus(ACTOR, { action: 'resume', userId: TARGET });
    expect(deletedTables()).toContain(sessions);
  });

  it('허용되지 않은 전이는 아무것도 쓰지 않는다', async () => {
    target({ status: 'departed' });

    await expect(
      changeUserStatus(ACTOR, { action: 'resume', userId: TARGET }),
    ).rejects.toBeInstanceOf(UserStatusTransitionError);

    expect(updateCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it('없는 사용자는 UserNotFoundError', async () => {
    txState.targetRows = [];
    await expect(
      changeUserStatus(ACTOR, { action: 'suspend', userId: TARGET }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
    expect(updateCalls).toHaveLength(0);
  });

  it('마지막 active 슈퍼어드민은 정지·퇴사할 수 없다', async () => {
    target({ status: 'active', isSuperadmin: true });
    txState.activeSuperadmins = 1;

    await expect(
      changeUserStatus(ACTOR, { action: 'suspend', userId: TARGET }),
    ).rejects.toBeInstanceOf(LastActiveSuperadminError);
    await expect(
      changeUserStatus(ACTOR, { action: 'depart', userId: TARGET }),
    ).rejects.toBeInstanceOf(LastActiveSuperadminError);
  });

  it('active 슈퍼어드민이 둘이면 하나는 정지할 수 있다', async () => {
    target({ status: 'active', isSuperadmin: true });
    txState.activeSuperadmins = 2;
    await expect(
      changeUserStatus(ACTOR, { action: 'suspend', userId: TARGET }),
    ).resolves.toEqual({ status: 'suspended' });
  });

  it('이미 정지된 슈퍼어드민의 퇴사는 남은 active 수와 무관하다', async () => {
    // 이 전이는 active 인원을 줄이지 않는다. 가드가 이 조건을 빠뜨리면 정지된 슈퍼어드민을
    // 영원히 정리할 수 없게 된다 (워크트리 Plan2 Task 5 회귀).
    target({ status: 'suspended', isSuperadmin: true });
    txState.activeSuperadmins = 0;

    await expect(changeUserStatus(ACTOR, { action: 'depart', userId: TARGET })).resolves.toEqual({
      status: 'departed',
    });
  });

  it('재입사는 임시 비밀번호 해시를 갈아끼우고 직책을 함께 저장한다', async () => {
    target({ status: 'departed' });

    const res = await changeUserStatus(ACTOR, {
      action: 'rehire',
      userId: TARGET,
      password: 'rehire-pw-12',
      jobTitle: '선임연구원',
    });

    expect(res).toEqual({ status: 'active' });
    expect(hash).toHaveBeenCalledWith('rehire-pw-12');
    expect(updatedValues(accounts)).toMatchObject({ password: 'hashed#12' });
    expect(updatedValues(users)).toMatchObject({ status: 'active', jobTitle: '선임연구원' });
    expect(deletedTables()).toContain(sessions);
    expect(inserted(userStatusEvents)).toMatchObject({
      fromStatus: 'departed',
      toStatus: 'active',
      reason: '슈퍼어드민 재입사 처리',
    });
  });

  it('재입사에서 비운 직책은 지운다', async () => {
    target({ status: 'departed' });
    await changeUserStatus(ACTOR, {
      action: 'rehire',
      userId: TARGET,
      password: 'rehire-pw-12',
    });
    expect(updatedValues(users)).toMatchObject({ jobTitle: null });
  });

  it('크리덴셜 행이 없으면 재입사가 새로 만든다', async () => {
    target({ status: 'departed' });
    // Better Auth 이전 이관분처럼 크리덴셜 계정이 없는 행. UPDATE 만 하면 0행을 고치고
    // 조용히 끝나 "재설정했는데 로그인은 안 되는" 상태가 된다.
    txState.credentialUpdateRows = [];

    await changeUserStatus(ACTOR, {
      action: 'rehire',
      userId: TARGET,
      password: 'rehire-pw-12',
    });

    expect(inserted(accounts)).toMatchObject({
      userId: TARGET,
      accountId: TARGET,
      providerId: CREDENTIAL_PROVIDER_ID,
      issuer: LOCAL_CREDENTIAL_ISSUER,
      password: 'hashed#12',
    });
  });

  it('정지·퇴사가 아닌 전이는 직책을 건드리지 않는다', async () => {
    target({ status: 'suspended' });
    await changeUserStatus(ACTOR, { action: 'resume', userId: TARGET });
    expect(updatedValues(users)).not.toHaveProperty('jobTitle');
  });
});

describe('resetUserPassword', () => {
  it('해시를 교체하고 세션을 끊고 from=to 감사 행을 남긴다', async () => {
    target({ status: 'active' });

    const res = await resetUserPassword(ACTOR, { userId: TARGET, password: 'temp-pw-1234' });

    expect(res).toEqual({ success: true });
    expect(updatedValues(accounts)).toMatchObject({ password: 'hashed#12' });
    expect(deletedTables()).toContain(sessions);
    expect(inserted(userStatusEvents)).toMatchObject({
      userId: TARGET,
      fromStatus: 'active',
      toStatus: 'active',
      changedBy: ACTOR,
      reason: '슈퍼어드민 비밀번호 재설정',
    });
  });

  it('평문 비밀번호는 어디에도 쓰지 않는다', async () => {
    target({ status: 'active' });
    await resetUserPassword(ACTOR, { userId: TARGET, password: 'temp-pw-1234' });
    const written = JSON.stringify([
      ...insertCalls.map((call) => call.values),
      ...updateCalls.map((call) => call.values),
    ]);
    expect(written).not.toContain('temp-pw-1234');
  });

  it('상태는 바꾸지 않는다 (정지·퇴사 계정도 재설정 자체는 된다)', async () => {
    target({ status: 'suspended' });
    await resetUserPassword(ACTOR, { userId: TARGET, password: 'temp-pw-1234' });
    // users 에 쓰는 것은 폐기 표식뿐이다 — status 는 건드리지 않는다(티켓 30).
    expect(updatedValues(users)).not.toHaveProperty('status');
    expect(updatedValues(users)).toHaveProperty('sessionsRevokedAt');
    expect(inserted(userStatusEvents)).toMatchObject({
      fromStatus: 'suspended',
      toStatus: 'suspended',
    });
  });

  it('없는 사용자는 UserNotFoundError', async () => {
    txState.targetRows = [];
    await expect(
      resetUserPassword(ACTOR, { userId: TARGET, password: 'temp-pw-1234' }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
    expect(updateCalls).toHaveLength(0);
  });
});
