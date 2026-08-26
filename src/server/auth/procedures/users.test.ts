import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

import { DuplicateEmailError } from '../domain/users';
import * as svc from '../services/users';
import { users } from './users';

vi.mock('../services/users', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
}));

const SUPERADMIN_ID = '11111111-1111-4111-8111-111111111111';

function context(opts: { isSuperadmin?: boolean } = {}): ORPCContext {
  return {
    db: {} as never,
    user: {
      id: SUPERADMIN_ID,
      email: 'su@megaresearch.co.kr',
      name: '슈퍼어드민',
      status: 'active',
      isSuperadmin: opts.isSuperadmin ?? true,
      userType: 'internal',
    },
    headers: new Headers(),
  };
}

function clientWith(opts: Parameters<typeof context>[0] = {}) {
  return createRouterClient({ users }, { context: context(opts) });
}

const VALID_CREATE = {
  userType: 'internal' as const,
  name: '김새로',
  email: 'saero.kim@megaresearch.co.kr',
  password: 'initial-pw-12',
  jobTitle: '연구원',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(svc.listUsers).mockResolvedValue({
    items: [],
    typeCounts: { all: 0, internal: 0, guest: 0, fieldwork: 0 },
  });
  vi.mocked(svc.createUser).mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222' });
});

describe('users 목록 procedure', () => {
  it('비-슈퍼어드민 호출은 FORBIDDEN', async () => {
    const client = clientWith({ isSuperadmin: false });
    await expect(client.users.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.listUsers).not.toHaveBeenCalled();
  });

  it('필터를 비우면 유형·상태 모두 all 로 위임한다', async () => {
    await clientWith().users.list({});
    expect(svc.listUsers).toHaveBeenCalledWith({ userType: 'all', status: 'all' });
  });

  it('필터를 그대로 위임한다', async () => {
    await clientWith().users.list({ userType: 'guest', status: 'suspended' });
    expect(svc.listUsers).toHaveBeenCalledWith({ userType: 'guest', status: 'suspended' });
  });
});

describe('users 생성 procedure', () => {
  it('비-슈퍼어드민 호출은 FORBIDDEN', async () => {
    const client = clientWith({ isSuperadmin: false });
    await expect(client.users.create(VALID_CREATE)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.createUser).not.toHaveBeenCalled();
  });

  it('행위자 id 와 정규화된 입력을 service 에 넘긴다', async () => {
    const res = await clientWith().users.create({
      ...VALID_CREATE,
      email: '  Saero.Kim@MegaResearch.co.kr ',
    });
    expect(svc.createUser).toHaveBeenCalledWith(SUPERADMIN_ID, {
      ...VALID_CREATE,
      email: 'saero.kim@megaresearch.co.kr',
    });
    expect(res).toEqual({ id: '22222222-2222-4222-8222-222222222222' });
  });

  it('비밀번호 8자 미만은 입력 검증에서 거부한다', async () => {
    await expect(
      clientWith().users.create({ ...VALID_CREATE, password: 'short7c' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.createUser).not.toHaveBeenCalled();
  });

  it('실사 유형은 아직 생성할 수 없다 (티켓 24)', async () => {
    await expect(
      // 모달의 실사 세그먼트는 비활성이지만, 서버가 유일한 판정자여야 한다.
      clientWith().users.create({ ...VALID_CREATE, userType: 'fieldwork' } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.createUser).not.toHaveBeenCalled();
  });

  it('이메일 중복은 CONFLICT 로 바꾼다', async () => {
    vi.mocked(svc.createUser).mockRejectedValue(new DuplicateEmailError());
    await expect(clientWith().users.create(VALID_CREATE)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '이미 사용 중인 이메일입니다.',
    });
  });

  it('그 밖의 예외는 그대로 올린다', async () => {
    vi.mocked(svc.createUser).mockRejectedValue(new Error('boom'));
    await expect(clientWith().users.create(VALID_CREATE)).rejects.toThrow();
  });
});

describe('users 생성 입력 정규화', () => {
  it('비워 보낸 직책은 미입력으로 접는다 (DB 에 빈 문자열을 남기지 않는다)', async () => {
    await clientWith().users.create({ ...VALID_CREATE, jobTitle: '   ' });
    expect(svc.createUser).toHaveBeenCalledWith(SUPERADMIN_ID, {
      ...VALID_CREATE,
      jobTitle: undefined,
    });
  });

  it('비워 보낸 소속 기관도 미입력으로 접는다', async () => {
    await clientWith().users.create({
      userType: 'guest',
      name: '김담당',
      email: 'client@klog.or.kr',
      password: 'initial-pw-12',
      organization: '',
    });
    expect(svc.createUser).toHaveBeenCalledWith(SUPERADMIN_ID, {
      userType: 'guest',
      name: '김담당',
      email: 'client@klog.or.kr',
      password: 'initial-pw-12',
      organization: undefined,
    });
  });
});
