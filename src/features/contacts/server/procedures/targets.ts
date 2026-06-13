import * as z from 'zod';

import { authed } from '@/server/orpc';

import {
  AddContactTargetInput,
  ContactTargetRowSchema,
  DeleteContactTargetInput,
  UpdateContactTargetInput,
} from '../../domain/contact-target';
import * as svc from '../services/contact-targets.service';

const add = authed
  .input(AddContactTargetInput)
  .output(ContactTargetRowSchema)
  .handler(({ input }) => svc.addContactTarget(input));

const update = authed
  .input(UpdateContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.updateContactTarget(input);
    return { ok: true as const };
  });

const remove = authed
  .input(DeleteContactTargetInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.deleteContactTarget(input);
    return { ok: true as const };
  });

export const targets = {
  add,
  update,
  remove,
};
