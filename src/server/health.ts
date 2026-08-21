import * as z from 'zod';

import { pub } from '@/server/orpc';

export const health = {
  check: pub
    .output(z.object({ ok: z.literal(true), now: z.string() }))
    .handler(() => ({ ok: true as const, now: new Date().toISOString() })),
};
