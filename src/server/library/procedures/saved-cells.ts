import * as z from 'zod';

import { authed } from '@/server/orpc';

import {
  CreateSavedCellInput,
  PartialTableCellSchema,
  SavedCellSchema,
} from '../domain/saved-cell';
import * as svc from '../services/saved-cells.service';

const list = authed
  .output(z.array(SavedCellSchema))
  .handler(() => svc.listSavedCells());

const search = authed
  .input(z.object({ query: z.string() }))
  .output(z.array(SavedCellSchema))
  .handler(({ input }) => svc.searchSavedCells(input.query));

const create = authed
  .input(CreateSavedCellInput)
  .output(SavedCellSchema)
  .handler(({ input }) => svc.createSavedCell(input));

const remove = authed
  .input(z.object({ id: z.string() }))
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.deleteSavedCell(input.id);
    return { ok: true as const };
  });

const apply = authed
  .input(z.object({ id: z.string() }))
  .output(PartialTableCellSchema.nullable())
  .handler(({ input }) => svc.applySavedCell(input.id));

export const savedCells = {
  list,
  search,
  create,
  remove,
  apply,
};
