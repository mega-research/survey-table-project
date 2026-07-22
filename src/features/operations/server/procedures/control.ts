import * as z from 'zod';

import { authed } from '@/server/orpc';

import * as svc from '../services/control.service';

const ControlStateSchema = z.object({
  isPaused: z.boolean(),
  pausedMessage: z.string().nullable(),
  testModeEnabled: z.boolean(),
  testToken: z.string().nullable(),
  accessIdentifier: z.string(),
  testResponseCount: z.number().int(),
  testTargetCount: z.number().int(),
  firstTestInviteCode: z.string().nullable(),
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
  .input(z.object({ surveyId: z.string(), enabled: z.literal(true) }))
  .output(ControlStateSchema)
  .handler(({ input }) => svc.setTestMode(input));

const disable = authed
  .input(
    z.object({
      surveyId: z.string(),
      disposition: z.enum(['keep', 'delete']),
    }),
  )
  .output(
    z.object({
      testModeEnabled: z.literal(false),
      deletedResponseCount: z.number().int(),
      deletedTargetCount: z.number().int(),
      remainingResponseCount: z.number().int(),
      remainingTargetCount: z.number().int(),
    }),
  )
  .handler(({ input }) => svc.disableTestWorkspace(input));

export const control = { get, setPaused, setTestMode, disable };
