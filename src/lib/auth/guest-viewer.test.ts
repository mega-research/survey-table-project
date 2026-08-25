import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuth } from '@/lib/auth';
import { isGuestViewer } from '@/lib/auth/guest-viewer';

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

describe('isGuestViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('grant 보유 사용자는 게스트로 판정한다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    vi.mocked(requireAuth).mockResolvedValue({ id: 'guest-1' } as never);
    await expect(isGuestViewer()).resolves.toBe(true);
  });

  it('grant 없는 사용자는 게스트가 아니다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    vi.mocked(requireAuth).mockResolvedValue({ id: 'admin-1' } as never);
    await expect(isGuestViewer()).resolves.toBe(false);
  });

  it('auth 조회가 실패하면 어드민으로 폴백하지 않고 throw 한다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    vi.mocked(requireAuth).mockRejectedValue(new Error('인증이 필요합니다.'));
    await expect(isGuestViewer()).rejects.toThrow('인증이 필요합니다.');
  });
});
