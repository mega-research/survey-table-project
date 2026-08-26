import { APIError } from 'better-auth/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { changePassword, findFirst, updateReturning, updateCalls } = vi.hoisted(() => ({
  changePassword: vi.fn(),
  findFirst: vi.fn(),
  updateReturning: { rows: [] as unknown[] },
  updateCalls: [] as unknown[],
}));

vi.mock('@/lib/auth/server', () => ({ auth: { api: { changePassword } } }));

vi.mock('@/db', () => ({
  db: {
    query: { users: { findFirst } },
    update: () => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: () => {
            updateCalls.push(values);
            return Promise.resolve(updateReturning.rows);
          },
        }),
      }),
    }),
  },
}));

import { InvalidAvatarUrlError } from '../domain/auth';
import { UserNotFoundError } from '../domain/users';
import { getProfile, updatePassword, updateProfile } from './auth';

const HEADERS = new Headers({ cookie: 'better-auth.session_token=t' });
const VALID = { currentPassword: 'old-pw-12', newPassword: 'new-pw-12', confirmPassword: 'new-pw-12' };

describe('updatePassword', () => {
  beforeEach(() => vi.clearAllMocks());

  it('새 비밀번호와 확인이 다르면 Better Auth 를 부르지 않는다', async () => {
    const res = await updatePassword(HEADERS, { ...VALID, confirmPassword: 'other-pw-12' });
    expect(res).toEqual({ error: '새 비밀번호가 일치하지 않습니다.' });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('8자 미만이면 Better Auth 를 부르지 않는다', async () => {
    const res = await updatePassword(HEADERS, {
      ...VALID,
      newPassword: 'short7c',
      confirmPassword: 'short7c',
    });
    expect(res).toEqual({ error: '비밀번호는 최소 8자 이상이어야 합니다.' });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('headers 가 없으면 세션을 증명할 수 없어 거부한다', async () => {
    const res = await updatePassword(undefined, VALID);
    expect(res).toEqual({ error: '로그인이 필요합니다.' });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('검증을 통과하면 다른 기기 세션 폐기와 함께 위임한다', async () => {
    changePassword.mockResolvedValue({});
    const res = await updatePassword(HEADERS, VALID);
    expect(changePassword).toHaveBeenCalledWith({
      body: {
        currentPassword: VALID.currentPassword,
        newPassword: VALID.newPassword,
        revokeOtherSessions: true,
      },
      headers: HEADERS,
    });
    expect(res).toEqual({ success: true });
  });

  it('재인증 실패 APIError 만 현재 비밀번호 오류 메시지로 접는다', async () => {
    changePassword.mockRejectedValue(
      new APIError('BAD_REQUEST', { message: 'Invalid password', code: 'INVALID_PASSWORD' }),
    );
    const res = await updatePassword(HEADERS, VALID);
    expect(res).toEqual({ error: '현재 비밀번호가 올바르지 않습니다.' });
  });

  it('재인증과 무관한 APIError 는 삼키지 않고 올린다', async () => {
    // Better Auth 는 세션 재발급·쿠키 설정 실패도 APIError 로 던진다. 통째로 뭉개면
    // 사용자는 맞는 비밀번호를 계속 다시 넣고 우리는 진짜 원인을 못 본다
    // (그 사이 비밀번호는 이미 바뀌어 있을 수도 있다).
    changePassword.mockRejectedValue(
      new APIError('INTERNAL_SERVER_ERROR', {
        message: 'failed to create session',
        code: 'FAILED_TO_CREATE_SESSION',
      }),
    );
    await expect(updatePassword(HEADERS, VALID)).rejects.toBeInstanceOf(APIError);
  });

  it('APIError 가 아닌 예외는 그대로 올린다', async () => {
    changePassword.mockRejectedValue(new Error('DB 연결 실패'));
    await expect(updatePassword(HEADERS, VALID)).rejects.toThrow('DB 연결 실패');
  });
});

const PROFILE_ROW = {
  id: '55555555-5555-4555-8555-555555555555',
  name: '김새로',
  email: 'saero.kim@megaresearch.co.kr',
  image: null,
  userType: 'internal' as const,
  jobTitle: '연구원',
  organization: null,
};

const R2_PUBLIC_URL = 'https://cdn.example.com';

describe('getProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(PROFILE_ROW);
  });

  it('DB 행을 그대로 돌려준다 (세션이 아니라 DB 를 읽는다)', async () => {
    // 아바타 URL 은 세션 페이로드에 없고, 직책은 사용자 관리에서 남이 바꿀 수 있다.
    await expect(getProfile(PROFILE_ROW.id)).resolves.toEqual(PROFILE_ROW);
  });

  it('행이 없으면 UserNotFoundError', async () => {
    findFirst.mockResolvedValue(undefined);
    await expect(getProfile(PROFILE_ROW.id)).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

describe('updateProfile', () => {
  // stubEnv 는 자동 복원되지 않는다(unstubEnvs 미설정) — 같은 워커의 다른 파일로 새지 않게 건다.
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
    updateReturning.rows = [PROFILE_ROW];
    vi.stubEnv('CLOUDFLARE_R2_PUBLIC_URL', R2_PUBLIC_URL);
  });

  it('이름과 아바타만 쓴다', async () => {
    await updateProfile(PROFILE_ROW.id, {
      name: '김새로',
      image: `${R2_PUBLIC_URL}/avatars/u/a.webp`,
    });
    expect(updateCalls[0]).toMatchObject({
      name: '김새로',
      image: `${R2_PUBLIC_URL}/avatars/u/a.webp`,
    });
    // 이메일·직책·소속·유형·상태는 자기 계정 표면에서 바뀌면 안 된다.
    const written = updateCalls[0] as Record<string, unknown>;
    for (const forbidden of ['email', 'jobTitle', 'organization', 'userType', 'status', 'isSuperadmin']) {
      expect(written).not.toHaveProperty(forbidden);
    }
  });

  it('아바타를 null 로 지울 수 있다', async () => {
    await updateProfile(PROFILE_ROW.id, { name: '김새로', image: null });
    expect(updateCalls[0]).toMatchObject({ image: null });
  });

  it('우리 R2 공개 URL 이 아니면 거부하고 아무것도 쓰지 않는다', async () => {
    // 외부 URL 을 넣으면 남의 서버가 우리 화면에 그림을 그리고 렌더될 때마다 그쪽 로그에
    // 우리 사용자의 IP·UA 가 남는다.
    await expect(
      updateProfile(PROFILE_ROW.id, { name: '김새로', image: 'https://evil.example/x.png' }),
    ).rejects.toBeInstanceOf(InvalidAvatarUrlError);
    expect(updateCalls).toHaveLength(0);
  });

  it('공개 URL 로 시작하는 척하는 주소도 거부한다', async () => {
    // 'https://cdn.example.com.evil.test/...' 는 startsWith 만 보면 통과한다 — 구분자까지 본다.
    await expect(
      updateProfile(PROFILE_ROW.id, { name: '김새로', image: `${R2_PUBLIC_URL}.evil.test/x.webp` }),
    ).rejects.toBeInstanceOf(InvalidAvatarUrlError);
    expect(updateCalls).toHaveLength(0);
  });

  it('R2 env 가 없으면 아바타 설정을 거부한다 (열어두는 쪽이 조용히 위험하다)', async () => {
    vi.stubEnv('CLOUDFLARE_R2_PUBLIC_URL', '');
    await expect(
      updateProfile(PROFILE_ROW.id, { name: '김새로', image: `${R2_PUBLIC_URL}/a.webp` }),
    ).rejects.toBeInstanceOf(InvalidAvatarUrlError);
  });

  it('아바타를 지우는 것은 R2 env 와 무관하다', async () => {
    vi.stubEnv('CLOUDFLARE_R2_PUBLIC_URL', '');
    await expect(
      updateProfile(PROFILE_ROW.id, { name: '김새로', image: null }),
    ).resolves.toEqual(PROFILE_ROW);
  });

  it('행이 없으면 UserNotFoundError', async () => {
    updateReturning.rows = [];
    await expect(
      updateProfile(PROFILE_ROW.id, { name: '김새로', image: null }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
