import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { authState } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string } },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: authState.user }, error: null })),
    },
  })),
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
] as const)('POST /api/upload/%s requires admin', (_name, POST, url) => {
  beforeEach(() => {
    authState.user = null;
  });

  afterEach(() => {
    delete process.env['ADMIN_USER_IDS'];
  });

  it('returns 401 without auth', async () => {
    const res = await POST(buildRequest(url) as never);
    expect(res.status).toBe(401);
  });

  it('returns 403 for authenticated user not in ADMIN_USER_IDS allowlist', async () => {
    authState.user = { id: 'intruder-id' };
    process.env['ADMIN_USER_IDS'] = 'real-admin-id';

    const res = await POST(buildRequest(url) as never);
    expect(res.status).toBe(403);
  });
});
