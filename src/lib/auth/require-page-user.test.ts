import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuth } from '@/lib/auth';
import { requirePageUser } from '@/lib/auth/require-page-user';

/**
 * 화면 렌더가 세션을 잃으면 「인증이 필요합니다.」 오류 화면 대신 원래 경로를 실어 로그인으로 보낸다.
 */

let requestPath: string | null = null;

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (requestPath !== null) h.set('x-request-path', requestPath);
    return h;
  },
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));

describe('requirePageUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestPath = null;
  });

  it('세션이 있으면 사용자를 돌려준다', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: 'admin-1' } as never);
    await expect(requirePageUser()).resolves.toEqual({ id: 'admin-1' });
  });

  it('세션이 없으면 원래 경로(쿼리 포함)를 실어 로그인으로 보낸다', async () => {
    requestPath = '/admin/surveys/s1/preview?x=1';
    vi.mocked(requireAuth).mockRejectedValue(new Error('인증이 필요합니다.'));
    await expect(requirePageUser()).rejects.toThrow(
      `NEXT_REDIRECT /admin/login?redirect=${encodeURIComponent('/admin/surveys/s1/preview?x=1')}`,
    );
  });

  it('경로가 없거나 내부 경로가 아니거나 로그인 자신이면 redirect 없이 로그인으로 보낸다', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('인증이 필요합니다.'));
    for (const path of [
      null,
      '//evil.example.com',
      'https://evil.example.com',
      '/admin/login?redirect=/x',
    ]) {
      requestPath = path;
      await expect(requirePageUser()).rejects.toThrow('NEXT_REDIRECT /admin/login');
      await expect(requirePageUser()).rejects.not.toThrow('redirect=');
    }
  });
});
