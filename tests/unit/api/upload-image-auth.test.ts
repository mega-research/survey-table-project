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

import { POST } from '@/app/api/upload/image/route';

function buildRequest() {
  const formData = new FormData();
  formData.set('file', new File(['dummy'], 'a.png', { type: 'image/png' }));
  formData.set('kind', 'survey');
  return new Request('http://localhost/api/upload/image', {
    method: 'POST',
    body: formData,
  });
}

describe('POST /api/upload/image requires admin', () => {
  beforeEach(() => {
    authState.user = null;
  });

  afterEach(() => {
    delete process.env['ADMIN_USER_IDS'];
  });

  it('returns 401 without auth', async () => {
    const response = await POST(buildRequest() as never);
    expect(response.status).toBe(401);
  });

  it('returns 403 for authenticated user not in ADMIN_USER_IDS allowlist', async () => {
    authState.user = { id: 'intruder-id' };
    process.env['ADMIN_USER_IDS'] = 'real-admin-id';

    const response = await POST(buildRequest() as never);
    expect(response.status).toBe(403);
  });
});
