import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { authState } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string; userType?: 'internal' | 'guest' | 'fieldwork' } },
}));

// 실물 requireAuth 와 같은 정책 — 세션 + active + **내부 계정**.
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => {
    const user = authState.user;
    if (!user) throw new Error('인증이 필요합니다.');
    const userType = user.userType ?? 'internal';
    if (userType !== 'internal') throw new Error('인증이 필요합니다.');
    return {
      id: user.id,
      email: 'a@b.com',
      name: '테스트',
      status: 'active',
      isSuperadmin: false,
      userType,
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

/**
 * 티켓 21 전에는 두 라우트의 게스트 허용 범위가 갈렸다 — 메일 첨부는 열고 공지 첨부는 403.
 * env grant 게스트가 내부 계정이라 문 안까지 들어왔기 때문이다. 계정 모델에서는 두 문
 * 모두 requireAuth 의 유형 게이트에서 먼저 닫힌다.
 */
describe('업로드 라우트의 청중은 내부 계정뿐이다', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['mail-attachment', mailAttachmentPOST, 'http://localhost/api/upload/mail-attachment'],
    ['notice-attachment', noticeAttachmentPOST, 'http://localhost/api/upload/notice-attachment'],
  ] as const)('%s 는 게스트 계정에 401 이다', async (_name, POST, url) => {
    authState.user = { id: 'guest-1', userType: 'guest' };
    const res = await POST(buildRequest(url) as never);
    expect(res.status).toBe(401);
  });

  it('내부 계정은 두 라우트 모두 403 이 아니다', async () => {
    authState.user = { id: 'admin-1' };
    const mail = await mailAttachmentPOST(
      buildRequest('http://localhost/api/upload/mail-attachment') as never,
    );
    const notice = await noticeAttachmentPOST(
      buildRequest('http://localhost/api/upload/notice-attachment') as never,
    );
    expect(mail.status).not.toBe(403);
    expect(notice.status).not.toBe(403);
  });
});
