/**
 * 링크 세션 procedure 의 쿠키 배선 (ADR-0026, 티켓 05).
 *
 * 판정은 코어(`server/access-link`)가 하고 실 DB 축은 링크 수명 스위트가 진다. 여기서
 * 지키는 것은 **이 파일밖에 지지 않는 것** 둘뿐이다.
 *  ① 쿠키 **속성** — `path: '/'`·httpOnly·sameSite. path 를 `/fw/...` 로 좁히면 대리 응답
 *     화면(`/survey/...`)에 세션이 실리지 않아 다음 티켓들의 전제가 무너진다. httpOnly 가
 *     빠지면 스크립트가 세션을 읽는다.
 *  ② 「나가기」가 **그 링크의 쿠키만** 지운다 — 두 조사를 병행하는 브라우저에서 남의 세션까지
 *     끊으면 그 사람은 다시 비밀번호를 받아야 한다.
 *
 * `next/headers` 를 목으로 세우는 것이 유일한 방법이다 — 쿠키 쓰기는 요청 컨텍스트 안에서만
 * 되고 vitest 에는 그 컨텍스트가 없다.
 */
import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

const cookieStore = vi.hoisted(() => ({
  set: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));

const core = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('@/server/access-link', () => ({
  authenticateAccessLink: core.authenticate,
}));

import { accessLinkSession } from './access-link-session';

const TOKEN = 'uNk2IUsrRx_Zk-R0';

const client = createRouterClient(
  { accessLinkSession },
  {
    context: {
      db: {} as never,
      user: null,
      headers: new Headers({ 'x-real-ip': '203.0.113.7' }),
    } satisfies ORPCContext,
  },
);

beforeEach(() => {
  cookieStore.set.mockReset();
  cookieStore.delete.mockReset();
  core.authenticate.mockReset();
});

describe('접속', () => {
  it('성공하면 토큰별 쿠키를 path=/ · httpOnly · sameSite=lax 로 심는다', async () => {
    core.authenticate.mockResolvedValue({
      ok: true,
      cookie: { name: `fw_${TOKEN}`, value: 'signed.value', maxAgeSeconds: 43200 },
    });

    await expect(
      client.accessLinkSession.authenticate({ token: TOKEN, password: 'Probe2026pw' }),
    ).resolves.toEqual({ ok: true });

    expect(cookieStore.set).toHaveBeenCalledWith({
      name: `fw_${TOKEN}`,
      value: 'signed.value',
      maxAge: 43200,
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('거부되면 쿠키를 심지 않고 사유를 그대로 돌려준다', async () => {
    core.authenticate.mockResolvedValue({ ok: false, reason: 'denied' });
    await expect(
      client.accessLinkSession.authenticate({ token: TOKEN, password: 'nope' }),
    ).resolves.toEqual({ ok: false, reason: 'denied' });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('닫힘도 에러가 아니라 사유로 나간다 — 화면이 닫힘 화면으로 갈아탄다', async () => {
    core.authenticate.mockResolvedValue({ ok: false, reason: 'closed' });
    await expect(
      client.accessLinkSession.authenticate({ token: TOKEN, password: 'Probe2026pw' }),
    ).resolves.toEqual({ ok: false, reason: 'closed' });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe('나가기', () => {
  it('그 링크의 쿠키 하나만 지운다', async () => {
    await expect(client.accessLinkSession.signOut({ token: TOKEN })).resolves.toEqual({
      success: true,
    });
    expect(cookieStore.delete).toHaveBeenCalledWith({ name: `fw_${TOKEN}`, path: '/' });
  });

  it('토큰 모양이 아니면 아무것도 지우지 않고 조용히 성공한다', async () => {
    // DB 를 읽지 않는 것이 요점이다 — 읽으면 로그아웃이 링크 존재 확인 창구가 된다.
    await expect(client.accessLinkSession.signOut({ token: 'short' })).resolves.toEqual({
      success: true,
    });
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });
});
