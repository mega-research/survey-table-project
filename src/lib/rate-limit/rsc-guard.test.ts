/**
 * RSC rate limit 가드.
 *
 * 이 가드의 값어치는 판정 자체가 아니라 **정책이 procedure 와 반대**라는 데 있다.
 * withRateLimit 은 IP 추출 실패 시 fail-closed 지만 여기는 fail-open 이다 —
 * 이 라우트는 응답자가 설문에 들어오는 유일한 입구라 헤더가 없다는 이유로 막으면
 * 정상 응답자가 링크를 열지 못한다. 뒤집히면 전원이 못 들어오므로 고정한다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const headersMock = vi.hoisted(() => vi.fn());
const isRateLimitedTwoTierMock = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ headers: () => headersMock() }));
vi.mock('@/lib/rate-limit/rate-limiter', () => ({
  isRateLimitedTwoTier: (...args: unknown[]) => isRateLimitedTwoTierMock(...args),
}));

import { isRscRateLimited } from '@/lib/rate-limit/rsc-guard';

beforeEach(() => {
  headersMock.mockReset();
  isRateLimitedTwoTierMock.mockReset().mockResolvedValue(false);
});

describe('isRscRateLimited', () => {
  it('신뢰 IP 가 없으면 통과시킨다 — procedure 와 반대로 fail-open', async () => {
    headersMock.mockResolvedValue(new Headers());

    await expect(isRscRateLimited('public-read')).resolves.toBe(false);
    // 판정 자체를 부르지 않는다 — 'unknown' 공유 버킷을 만들지 않기 위함.
    expect(isRateLimitedTwoTierMock).not.toHaveBeenCalled();
  });

  it('한도 초과면 true 를 돌려준다', async () => {
    headersMock.mockResolvedValue(new Headers({ 'x-real-ip': '203.0.113.7' }));
    isRateLimitedTwoTierMock.mockResolvedValue(true);

    await expect(isRscRateLimited('public-read')).resolves.toBe(true);
  });

  it('procedure 와 같은 버킷을 쓴다 — 그룹 그대로, clientId 는 null', async () => {
    headersMock.mockResolvedValue(new Headers({ 'x-real-ip': '203.0.113.7' }));

    await isRscRateLimited('public-read');

    // clientId 가 붙으면 키가 `group:ip:clientId` 로 갈려 RPC 경로와 다른 버킷이 된다.
    // 진입 시점엔 sessionId/responseId 도 없다.
    expect(isRateLimitedTwoTierMock).toHaveBeenCalledWith('public-read', '203.0.113.7', null);
  });

  it('Vercel 헤더를 x-real-ip 보다 우선한다', async () => {
    headersMock.mockResolvedValue(
      new Headers({ 'x-vercel-forwarded-for': '198.51.100.1', 'x-real-ip': '203.0.113.7' }),
    );

    await isRscRateLimited('public-read');

    expect(isRateLimitedTwoTierMock).toHaveBeenCalledWith('public-read', '198.51.100.1', null);
  });
});
