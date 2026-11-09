import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 링크 조회만 모킹한다 — 세션 쿠키 판정은 1차 게이트(proxy)와 같은 실제 함수를 태운다.
const { listAccessLinksMock } = vi.hoisted(() => ({ listAccessLinksMock: vi.fn() }));

vi.mock('@/server/workspace/services/access-links', () => ({
  listAccessLinks: listAccessLinksMock,
}));

import { GET } from '@/app/api/legacy-guest-link/[surveyId]/[[...rest]]/route';

const GRANTED = '9f550d8b-24d2-4b19-b5d7-00684e0d8644';
const OTHER = '11111111-2222-4333-8444-555555555555';
const GUEST = '7ea4b5f9-a128-474c-bf87-270498629281';
const TOKEN = '_c8lYtPtU5bf4HAq';
const ORIGIN = 'https://survey.example.com';

function call(
  surveyId: string,
  { rest, search = '', cookie }: { rest?: string[]; search?: string; cookie?: string } = {},
) {
  const path = `/api/legacy-guest-link/${surveyId}${rest ? `/${rest.join('/')}` : ''}${search}`;
  const request = new NextRequest(`${ORIGIN}${path}`, cookie ? { headers: { cookie } } : undefined);
  return GET(request, { params: Promise.resolve(rest ? { surveyId, rest } : { surveyId }) });
}

const locationOf = (res: Response) => res.headers.get('location');

describe('GET /api/legacy-guest-link/[surveyId]', () => {
  beforeEach(() => {
    listAccessLinksMock.mockReset();
    listAccessLinksMock.mockResolvedValue([{ token: TOKEN }]);
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST}:${GRANTED}`);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('세션 없는 방문자가 옛 게스트 설문 주소로 오면 그 설문의 외주 링크로 보낸다', async () => {
    const res = await call(GRANTED);

    expect(res.status).toBe(307);
    expect(locationOf(res)).toBe(`${ORIGIN}/fw/${TOKEN}`);
    expect(listAccessLinksMock).toHaveBeenCalledWith(GRANTED, 'fieldwork');
  });

  it('하위 경로로 와도 링크의 입구로 보낸다 — 어느 탭으로 갈지는 링크 쪽이 정한다', async () => {
    const res = await call(GRANTED, { rest: ['contacts', 'abc'], search: '?page=2' });

    expect(locationOf(res)).toBe(`${ORIGIN}/fw/${TOKEN}`);
  });

  it('직원 세션 쿠키가 있으면 링크를 찾지 않고 내부 콘솔로 보낸다', async () => {
    const res = await call(GRANTED, {
      rest: ['contacts'],
      search: '?page=2',
      cookie: 'better-auth.session_token=abc.def',
    });

    expect(res.status).toBe(307);
    expect(locationOf(res)).toBe(`${ORIGIN}/surveys/${GRANTED}/operations/contacts?page=2`);
    expect(listAccessLinksMock).not.toHaveBeenCalled();
  });

  it('운영 환경의 보안 접두 쿠키도 직원 세션으로 읽는다', async () => {
    const res = await call(GRANTED, { cookie: '__Secure-better-auth.session_token=abc.def' });

    expect(locationOf(res)).toBe(`${ORIGIN}/surveys/${GRANTED}/operations`);
  });

  it('옛 게스트 설문이 아니면 링크를 찾지 않는다 — 설문 id 로 토큰을 알아내는 창구가 되지 않는다', async () => {
    const res = await call(OTHER);

    expect(locationOf(res)).toBe(`${ORIGIN}/surveys/${OTHER}/operations`);
    expect(listAccessLinksMock).not.toHaveBeenCalled();
  });

  it('열린 외주 링크가 없으면 내부 콘솔 주소로 보낸다(그 뒤는 로그인 게이트가 받는다)', async () => {
    listAccessLinksMock.mockResolvedValue([]);

    const res = await call(GRANTED, { rest: ['overview'] });

    expect(locationOf(res)).toBe(`${ORIGIN}/surveys/${GRANTED}/operations/overview`);
  });

  /**
   * 열린 외주 링크가 둘 이상이면 어느 업체의 링크로 보낼지 정할 수 없다(fieldwork-multi-company
   * 티켓 02). 아무 링크로나 보내면 엉뚱한 업체의 주소(토큰)를 내주게 되므로 링크로 보내지 않는다 —
   * 쿠키·비밀번호로 고르는 다리는 티켓 10 이 세운다.
   */
  it('열린 외주 링크가 둘 이상이면 어느 링크로도 보내지 않고 내부 콘솔 주소로 보낸다', async () => {
    listAccessLinksMock.mockResolvedValue([{ token: TOKEN }, { token: 'sEcondTokenAbcd0' }]);

    const res = await call(GRANTED);

    expect(res.status).toBe(307);
    expect(locationOf(res)).toBe(`${ORIGIN}/surveys/${GRANTED}/operations`);
    expect(locationOf(res)).not.toContain('/fw/');
  });

  it('grant 목록을 비우면 다리가 꺼진다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', '');

    const res = await call(GRANTED);

    expect(locationOf(res)).toBe(`${ORIGIN}/surveys/${GRANTED}/operations`);
    expect(listAccessLinksMock).not.toHaveBeenCalled();
  });

  it('리다이렉트를 캐시하지 않게 한다 — 다리를 걷은 뒤에도 옛 답이 남으면 안 된다', async () => {
    const res = await call(GRANTED);

    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
