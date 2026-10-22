import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuth } from '@/lib/auth';
import { isGuestViewer, isOverviewOnlyViewer } from '@/lib/auth/guest-viewer';

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

describe('isOverviewOnlyViewer', () => {
  const GUEST9 = 'c79af8a1-186a-4157-be4c-2bebfbde4a8d';
  const AI_2026_PUBLIC = '253534a5-913a-4891-a019-f9643ccea0a7';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('등록된 계정·설문 쌍에서만 참이다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST9}:${AI_2026_PUBLIC},guest-1:${SURVEY_ID}`);
    vi.mocked(requireAuth).mockResolvedValue({ id: GUEST9 } as never);
    await expect(isOverviewOnlyViewer(AI_2026_PUBLIC)).resolves.toBe(true);
    vi.mocked(requireAuth).mockResolvedValue({ id: 'guest-1' } as never);
    await expect(isOverviewOnlyViewer(SURVEY_ID)).resolves.toBe(false);
  });
});
