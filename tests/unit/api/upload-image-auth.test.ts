import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  })),
}));

import { POST } from '@/app/api/upload/image/route';

describe('POST /api/upload/image requires authentication', () => {
  it('returns 401 without auth', async () => {
    const formData = new FormData();
    formData.set('file', new File(['dummy'], 'a.png', { type: 'image/png' }));
    formData.set('kind', 'survey');

    const request = new Request('http://localhost/api/upload/image', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request as any);
    expect(response.status).toBe(401);
  });
});
