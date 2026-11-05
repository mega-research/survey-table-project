import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuth } from '@/lib/auth';
import { canOpenSurveyPreview, isGuestViewer, isViewOnlyViewer } from '@/lib/auth/guest-viewer';

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-request-path': '/admin/surveys/s1/operations/overview' }),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));

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

  it('auth 조회가 실패하면 어드민으로 폴백하지 않고 로그인으로 보낸다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    vi.mocked(requireAuth).mockRejectedValue(new Error('인증이 필요합니다.'));
    await expect(isGuestViewer()).rejects.toThrow(
      'NEXT_REDIRECT /admin/login?redirect=%2Fadmin%2Fsurveys%2Fs1%2Foperations%2Foverview',
    );
  });
});

describe('isViewOnlyViewer', () => {
  const GUEST9 = 'c79af8a1-186a-4157-be4c-2bebfbde4a8d';
  const AI_2026_PUBLIC = '253534a5-913a-4891-a019-f9643ccea0a7';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('등록된 계정·설문 쌍에서만 참이다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST9}:${AI_2026_PUBLIC},guest-1:${SURVEY_ID}`);
    vi.mocked(requireAuth).mockResolvedValue({ id: GUEST9 } as never);
    await expect(isViewOnlyViewer(AI_2026_PUBLIC)).resolves.toBe(true);
    vi.mocked(requireAuth).mockResolvedValue({ id: 'guest-1' } as never);
    await expect(isViewOnlyViewer(SURVEY_ID)).resolves.toBe(false);
  });
});

describe('canOpenSurveyPreview', () => {
  const GUEST9 = 'c79af8a1-186a-4157-be4c-2bebfbde4a8d';
  const AI_2026_PUBLIC = '253534a5-913a-4891-a019-f9643ccea0a7';
  const DAIRY = '75060289-51b4-44e7-8fd1-dabf73a0bfaf';
  const DAIRY_2026 = '24b15972-36fe-400a-adfe-7d4c80438204';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('보기 전용이 아니면 열고, 보기 전용은 설문 보기를 허용한 grant 만 연다', async () => {
    vi.stubEnv(
      'GUEST_SURVEY_GRANTS',
      `${GUEST9}:${AI_2026_PUBLIC},${DAIRY}:${DAIRY_2026},guest-1:${SURVEY_ID}`,
    );
    vi.mocked(requireAuth).mockResolvedValue({ id: 'guest-1' } as never);
    await expect(canOpenSurveyPreview(SURVEY_ID)).resolves.toBe(true);
    vi.mocked(requireAuth).mockResolvedValue({ id: GUEST9 } as never);
    await expect(canOpenSurveyPreview(AI_2026_PUBLIC)).resolves.toBe(false);
    vi.mocked(requireAuth).mockResolvedValue({ id: DAIRY } as never);
    await expect(canOpenSurveyPreview(DAIRY_2026)).resolves.toBe(true);
  });
});
