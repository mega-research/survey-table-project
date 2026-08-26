import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * admin 레이아웃의 경로 가드는 하드 내비게이션에서만 다시 돈다(공통 레이아웃은 소프트
 * 내비게이션에서 재렌더되지 않는다). 설문 경계는 surveys/[id] 레이아웃이 이 가드로 다시 본다.
 */
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const requireAuth = vi.fn();

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/lib/auth', () => ({ requireAuth }));

async function loadGuard() {
  const mod = await import('@/lib/auth/guest-page-guard');
  return mod.assertGuestSurveyPageAccess;
}

describe('assertGuestSurveyPageAccess', () => {
  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
    requireAuth.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('게스트가 아닌 active 계정은 어느 설문이든 통과한다', async () => {
    requireAuth.mockResolvedValue({ id: 'admin-1' });
    const guard = await loadGuard();
    await expect(guard('survey-x')).resolves.toBeUndefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('게스트는 grant 설문만 통과한다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    requireAuth.mockResolvedValue({ id: 'guest-1' });
    const guard = await loadGuard();
    await expect(guard('survey-a')).resolves.toBeUndefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('게스트가 grant 밖 설문에 오면 notFound - 존재 여부를 노출하지 않는다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    requireAuth.mockResolvedValue({ id: 'guest-1' });
    const guard = await loadGuard();
    await expect(guard('survey-b')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('미인증·비활성 계정은 requireAuth 가 먼저 막는다', async () => {
    requireAuth.mockRejectedValue(new Error('인증이 필요합니다.'));
    const guard = await loadGuard();
    await expect(guard('survey-a')).rejects.toThrow('인증이 필요합니다.');
    expect(notFound).not.toHaveBeenCalled();
  });
});
