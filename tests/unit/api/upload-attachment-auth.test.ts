import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { authState } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string } },
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => {
    if (!authState.user) throw new Error('인증이 필요합니다.');
    return {
      id: authState.user.id,
      email: 'a@b.com',
      name: '테스트',
      status: 'active',
      isSuperadmin: false,
    };
  }),
}));

import { POST as mailAttachmentPOST } from '@/app/api/upload/mail-attachment/route';
import { POST as noticeAttachmentPOST } from '@/app/api/upload/notice-attachment/route';

function buildRequest(url: string) {
  const formData = new FormData();
  formData.set('file', new File(['dummy'], 'a.pdf', { type: 'application/pdf' }));
  return new Request(url, { method: 'POST', body: formData });
}

describe.each([
  ['mail-attachment', mailAttachmentPOST, 'http://localhost/api/upload/mail-attachment'],
  ['notice-attachment', noticeAttachmentPOST, 'http://localhost/api/upload/notice-attachment'],
] as const)('POST /api/upload/%s requires auth', (_name, POST, url) => {
  beforeEach(() => {
    authState.user = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 without auth', async () => {
    const res = await POST(buildRequest(url) as never);
    expect(res.status).toBe(401);
  });
});

describe('게스트 허용 범위는 라우트마다 다르다', () => {
  beforeEach(() => {
    authState.user = { id: 'guest-1' };
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('메일 첨부는 게스트도 올린다 - tmp 네임스페이스 한정', async () => {
    const res = await mailAttachmentPOST(
      buildRequest('http://localhost/api/upload/mail-attachment') as never,
    );
    expect(res.status).not.toBe(403);
  });

  it('공지 첨부는 게스트가 403 - oRPC authed 와 같은 정책', async () => {
    const res = await noticeAttachmentPOST(
      buildRequest('http://localhost/api/upload/notice-attachment') as never,
    );
    expect(res.status).toBe(403);
  });
});
