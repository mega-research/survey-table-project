import * as z from 'zod';

import { authed } from '@/server/orpc';

import * as svc from '../services/control.service';

const ControlStateSchema = z.object({
  isPaused: z.boolean(),
  pausedMessage: z.string().nullable(),
  testModeEnabled: z.boolean(),
  testToken: z.string().nullable(),
  testResponseCount: z.number().int(),
});

const get = authed
  .input(z.object({ surveyId: z.string() }))
  .output(ControlStateSchema)
  .handler(({ input }) => svc.getControlState(input.surveyId));

const setPaused = authed
  .input(
    z.object({
      surveyId: z.string(),
      isPaused: z.boolean(),
      pausedMessage: z.string().max(500).nullish(),
    }),
  )
  .output(z.object({ isPaused: z.boolean(), pausedMessage: z.string().nullable() }))
  .handler(({ input }) =>
    svc.setPaused({
      surveyId: input.surveyId,
      isPaused: input.isPaused,
      ...(input.pausedMessage !== undefined ? { pausedMessage: input.pausedMessage } : {}),
    }),
  );

const setTestMode = authed
  .input(z.object({ surveyId: z.string(), enabled: z.boolean() }))
  .output(z.object({ testModeEnabled: z.boolean(), testToken: z.string().nullable() }))
  .handler(({ input }) => svc.setTestMode(input));

const deleteTestResponses = authed
  .input(z.object({ surveyId: z.string() }))
  .output(z.object({ deletedCount: z.number().int() }))
  .handler(({ input }) => svc.deleteTestResponses(input.surveyId));

export const control = { get, setPaused, setTestMode, deleteTestResponses };
