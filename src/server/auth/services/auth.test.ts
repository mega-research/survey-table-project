import { APIError } from 'better-auth/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { changePassword } = vi.hoisted(() => ({ changePassword: vi.fn() }));

vi.mock('@/lib/auth/server', () => ({ auth: { api: { changePassword } } }));

import { updatePassword } from './auth';

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

  it('APIError 는 현재 비밀번호 오류 메시지로 접는다', async () => {
    changePassword.mockRejectedValue(
      new APIError('BAD_REQUEST', { message: 'Invalid password', code: 'INVALID_PASSWORD' }),
    );
    const res = await updatePassword(HEADERS, VALID);
    expect(res).toEqual({ error: '현재 비밀번호가 올바르지 않습니다.' });
  });

  it('APIError 가 아닌 예외는 그대로 올린다', async () => {
    changePassword.mockRejectedValue(new Error('DB 연결 실패'));
    await expect(updatePassword(HEADERS, VALID)).rejects.toThrow('DB 연결 실패');
  });
});
