import * as z from 'zod';

import { authed } from '@/server/orpc';

import { UpdateContactColumnsInput } from '../../domain/contact-column';
import * as svc from '../services/contact-columns.service';

const update = authed
  .input(UpdateContactColumnsInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.updateContactColumns(input);
    return { ok: true as const };
  });

export const columns = {
  update,
};
