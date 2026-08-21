import * as z from 'zod';

import { authed } from '@/server/orpc';

import {
  CreateCategoryInput,
  QuestionCategorySchema,
  UpdateCategoryInput,
} from '../domain/question-category';
import * as svc from '../services/question-categories.service';

const list = authed
  .output(z.array(QuestionCategorySchema))
  .handler(() => svc.listCategories());

const create = authed
  .input(CreateCategoryInput)
  .output(QuestionCategorySchema)
  .handler(({ input }) => svc.createCategory(input));

const update = authed
  .input(UpdateCategoryInput)
  .output(QuestionCategorySchema)
  .handler(({ input }) => svc.updateCategory(input.id, input.updates));

const remove = authed
  .input(z.object({ id: z.string() }))
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.deleteCategory(input.id);
    return { ok: true as const };
  });

const initializeDefaults = authed
  .output(z.array(QuestionCategorySchema))
  .handler(() => svc.initializeDefaultCategories());

export const questionCategories = {
  list,
  create,
  update,
  remove,
  initializeDefaults,
};
