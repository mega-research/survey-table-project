import * as z from 'zod';

import { assertSurveyAccess, authed, scoped } from '@/server/orpc';

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

const get = scoped
  .input(z.object({ surveyId: z.string() }))
  .output(ControlStateSchema)
  .handler(({ input, context }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.getControlState(input.surveyId);
  });

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

const setTestMode = scoped
  .input(z.object({ surveyId: z.string(), enabled: z.literal(true) }))
  .output(ControlStateSchema)
  .handler(({ input, context }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.setTestMode(input);
  });

const disable = scoped
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
  .handler(({ input, context }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.disableTestWorkspace(input);
  });

export const control = { get, setPaused, setTestMode, disable };
