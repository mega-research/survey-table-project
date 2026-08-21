import * as z from 'zod';

import { authed } from '@/server/orpc';

import {
  CreateSavedLookupInput,
  ListSavedLookupsInput,
  SavedLookupSchema,
  UpdateSavedLookupInput,
} from '../domain/saved-lookup';
import * as svc from '../services/saved-lookups.service';

const list = authed
  .input(ListSavedLookupsInput.optional())
  .output(z.array(SavedLookupSchema))
  .handler(({ input }) => svc.listSavedLookups(input ?? {}));

const create = authed
  .input(CreateSavedLookupInput)
  .output(SavedLookupSchema)
  .handler(({ input }) => svc.createSavedLookup(input));

const update = authed
  .input(UpdateSavedLookupInput)
  .output(SavedLookupSchema)
  .handler(({ input }) => svc.updateSavedLookup(input.id, input.updates));

const remove = authed
  .input(z.object({ id: z.string() }))
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.deleteSavedLookup(input.id);
    return { ok: true as const };
  });

export const savedLookups = {
  list,
  create,
  update,
  remove,
};
