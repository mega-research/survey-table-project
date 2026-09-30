import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionCookie } = vi.hoisted(() => ({ getSessionCookie: vi.fn() }));
vi.mock('better-auth/cookies', () => ({ getSessionCookie }));

import { config, proxy } from '@/proxy';

import { SESSION_GATED_ROOT_SEGMENTS } from './protected-paths';

/**
 * proxy 는 1차 게이트다 — 세션 쿠키 "존재"만 보고 DB 를 조회하지 않는다.
 * 쿠키가 있어도 유효성·계정 상태는 내부·분석 레이아웃이 다시 본다(2단 게이트).
 */
function req(pathname: string, search = '') {
  return new NextRequest(`https://example.com${pathname}${search}`);
}

beforeEach(() => vi.clearAllMocks());

describe('proxy 세션 쿠키 게이트', () => {
  it('쿠키가 없으면 원래 목적지를 실어 로그인으로 보낸다', () => {
    getSessionCookie.mockReturnValue(null);
    const res = proxy(req('/surveys', '?page=2'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'https://example.com/login?redirect=%2Fsurveys%3Fpage%3D2',
    );
  });

  it('로그인 페이지는 쿠키 없이도 통과한다 — 리다이렉트 루프 방지', () => {
    getSessionCookie.mockReturnValue(null);
    const res = proxy(req('/login'));
    expect(res.headers.get('location')).toBeNull();
    expect(getSessionCookie).not.toHaveBeenCalled();
  });

  it('쿠키가 있으면 통과시키고 x-pathname 을 레이아웃에 넘긴다', () => {
    getSessionCookie.mockReturnValue('token');
    const res = proxy(req('/surveys/s1/operations/overview'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-pathname')).toBe(
      '/surveys/s1/operations/overview',
    );
  });

  it('쿠키 존재만 보고 세션 유효성은 판단하지 않는다 — 무효 토큰도 여기선 통과', () => {
    getSessionCookie.mockReturnValue('stale-token');
    const res = proxy(req('/analytics'));
    expect(res.headers.get('location')).toBeNull();
  });

  /**
   * matcher 리터럴 ↔ 어휘 대조.
   *
   * Next 는 matcher 를 빌드 타임에 정적으로 읽으므로 `SESSION_GATED_ROOT_SEGMENTS` 를 펼쳐
   * 쓸 수 없고, 리터럴이 그 사본이다. 사본이 어긋나면 그 루트만 1차 게이트 밖에서 자란다 —
   * 어휘 자체의 완전성(파일 시스템 대조)은 `tests/repo/proxy-matcher-coverage.test.ts` 몫이고,
   * 여기서는 **리터럴이 어휘를 빠뜨리지도 넘지도 않는가**만 본다.
   */
  it('matcher 리터럴이 세션 게이트 어휘와 정확히 일치한다', () => {
    const roots = new Set(
      config.matcher.map((pattern) => pattern.replace(/^\//, '').replace(/\/:path\*$/, '')),
    );
    expect([...roots].sort()).toEqual([...SESSION_GATED_ROOT_SEGMENTS].sort());
  });

  it('루트마다 두 줄을 적는다 — 한쪽만이면 그 절반이 무방비다', () => {
    // '/surveys/:path*' 는 '/surveys' 자체를 매치하지 않는다(Next 의 path-to-regexp 의미론).
    // 목록 화면이 정확히 그 자리라, 루트 리터럴을 빠뜨리면 목록만 세션 없이 렌더를 시작한다.
    for (const root of SESSION_GATED_ROOT_SEGMENTS) {
      expect(config.matcher).toContain(`/${root}`);
      expect(config.matcher).toContain(`/${root}/:path*`);
    }
    expect(config.matcher).toHaveLength(SESSION_GATED_ROOT_SEGMENTS.length * 2);
  });

  it('외주 실사 링크 구역은 matcher 밖이다 — 링크 세션은 계정 쿠키가 없다', () => {
    // 여기 넣으면 외주가 전원 로그인으로 튕겨 기능이 통째로 닫힌다 (ADR-0026).
    expect(config.matcher.some((pattern) => pattern.startsWith('/fw'))).toBe(false);
  });
});
