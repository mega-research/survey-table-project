import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireActiveAccount } from '@/lib/auth';
import { isGuestViewer } from '@/lib/auth/guest-viewer';

vi.mock('@/lib/auth', () => ({ requireActiveAccount: vi.fn() }));

/**
 * 판정 출처가 티켓 21 에서 env grant 목록에서 **계정 유형**으로 바뀌었다.
 * 쓰이는 곳은 접근제어가 아니라 데이터 파티션이다(게스트는 언제나 실데이터).
 */
describe('isGuestViewer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('guest 유형 계정은 게스트로 판정한다', async () => {
    vi.mocked(requireActiveAccount).mockResolvedValue({ userType: 'guest' } as never);
    await expect(isGuestViewer()).resolves.toBe(true);
  });

  it('내부·실사 계정은 게스트가 아니다', async () => {
    vi.mocked(requireActiveAccount).mockResolvedValue({ userType: 'internal' } as never);
    await expect(isGuestViewer()).resolves.toBe(false);
  });

  it('실사 계정도 게스트가 아니다 — 유형이 뭉개지지 않는다', async () => {
    vi.mocked(requireActiveAccount).mockResolvedValue({ userType: 'fieldwork' } as never);
    await expect(isGuestViewer()).resolves.toBe(false);
  });

  it('auth 조회가 실패하면 어드민으로 폴백하지 않고 throw 한다', async () => {
    vi.mocked(requireActiveAccount).mockRejectedValue(new Error('인증이 필요합니다.'));
    await expect(isGuestViewer()).rejects.toThrow('인증이 필요합니다.');
  });
});
