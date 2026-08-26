import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionCookie } = vi.hoisted(() => ({ getSessionCookie: vi.fn() }));
vi.mock('better-auth/cookies', () => ({ getSessionCookie }));

import { config, proxy } from '@/proxy';

/**
 * proxy 는 1차 게이트다 — 세션 쿠키 "존재"만 보고 DB 를 조회하지 않는다.
 * 쿠키가 있어도 유효성·계정 상태는 admin/analytics 레이아웃이 다시 본다(2단 게이트).
 */
function req(pathname: string, search = '') {
  return new NextRequest(`https://example.com${pathname}${search}`);
}

beforeEach(() => vi.clearAllMocks());

describe('proxy 세션 쿠키 게이트', () => {
  it('쿠키가 없으면 원래 목적지를 실어 로그인으로 보낸다', () => {
    getSessionCookie.mockReturnValue(null);
    const res = proxy(req('/admin/surveys', '?page=2'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'https://example.com/admin/login?redirect=%2Fadmin%2Fsurveys%3Fpage%3D2',
    );
  });

  it('로그인 페이지는 쿠키 없이도 통과한다 — 리다이렉트 루프 방지', () => {
    getSessionCookie.mockReturnValue(null);
    const res = proxy(req('/admin/login'));
    expect(res.headers.get('location')).toBeNull();
    expect(getSessionCookie).not.toHaveBeenCalled();
  });

  it('쿠키가 있으면 통과시키고 x-pathname 을 레이아웃에 넘긴다', () => {
    getSessionCookie.mockReturnValue('token');
    const res = proxy(req('/admin/surveys/s1/operations/overview'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-pathname')).toBe(
      '/admin/surveys/s1/operations/overview',
    );
  });

  it('쿠키 존재만 보고 세션 유효성은 판단하지 않는다 — 무효 토큰도 여기선 통과', () => {
    getSessionCookie.mockReturnValue('stale-token');
    const res = proxy(req('/analytics'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('내부 구역과 계정 유형 구역을 모두 보호한다', () => {
    // 유형 구역(/guest·/fieldwork)을 빠뜨리면 그 구역만 세션 없이 렌더를 시작한다.
    expect(config.matcher).toEqual([
      '/admin/:path*',
      '/analytics/:path*',
      '/guest/:path*',
      '/fieldwork/:path*',
    ]);
  });
});
