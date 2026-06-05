import * as z from 'zod';

import { authed } from '@/server/orpc';

import {
  CreateSavedQuestionInput,
  QuestionSchema,
  SavedQuestionSchema,
  UpdateSavedQuestionInput,
} from '../../domain/saved-question';
import * as svc from '../services/saved-questions.service';

const list = authed
  .output(z.array(SavedQuestionSchema))
  .handler(() => svc.listSavedQuestions());

const search = authed
  .input(z.object({ query: z.string() }))
  .output(z.array(SavedQuestionSchema))
  .handler(({ input }) => svc.searchSavedQuestions(input.query));

const byCategory = authed
  .input(z.object({ category: z.string() }))
  .output(z.array(SavedQuestionSchema))
  .handler(({ input }) => svc.getSavedQuestionsByCategory(input.category));

const recentlyUsed = authed
  .input(z.object({ limit: z.number().optional() }))
  .output(z.array(SavedQuestionSchema))
  .handler(({ input }) => svc.getRecentlyUsedQuestions(input.limit));

const mostUsed = authed
  .input(z.object({ limit: z.number().optional() }))
  .output(z.array(SavedQuestionSchema))
  .handler(({ input }) => svc.getMostUsedQuestions(input.limit));

const byTag = authed
  .input(z.object({ tag: z.string() }))
  .output(z.array(SavedQuestionSchema))
  .handler(({ input }) => svc.getSavedQuestionsByTag(input.tag));

const create = authed
  .input(CreateSavedQuestionInput)
  .output(SavedQuestionSchema)
  .handler(({ input }) => svc.createSavedQuestion(input));

const update = authed
  .input(UpdateSavedQuestionInput)
  .output(SavedQuestionSchema)
  .handler(({ input }) => svc.updateSavedQuestion(input.id, input.updates));

const remove = authed
  .input(z.object({ id: z.string() }))
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.deleteSavedQuestion(input.id);
    return { ok: true as const };
  });

const apply = authed
  .input(z.object({ id: z.string() }))
  .output(QuestionSchema.nullable())
  .handler(({ input }) => svc.applySavedQuestion(input.id));

const applyMultiple = authed
  .input(z.object({ ids: z.array(z.string()) }))
  .output(z.array(QuestionSchema))
  .handler(({ input }) => svc.applyMultipleSavedQuestions(input.ids));

export const savedQuestions = {
  list,
  search,
  byCategory,
  recentlyUsed,
  mostUsed,
  byTag,
  create,
  update,
  remove,
  apply,
  applyMultiple,
};
