import { createRouterClient } from '@orpc/server';
import { describe, expect, it } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { router } from '@/server/router';

function mockContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: null };
}

describe('health.check', () => {
  it('ok:true 와 ISO now 를 반환한다', async () => {
    const client = createRouterClient(router, { context: mockContext() });
    const res = await client.health.check();
    expect(res.ok).toBe(true);
    expect(() => new Date(res.now).toISOString()).not.toThrow();
  });
});
