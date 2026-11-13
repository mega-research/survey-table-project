import * as z from 'zod';

import { authed } from '@/server/orpc';

import * as svc from '../services/control';

const ControlStateSchema = z.object({
  isPaused: z.boolean(),
  pausedMessage: z.string().nullable(),
  testModeEnabled: z.boolean(),
  testViewInBrowser: z.boolean(),
  testToken: z.string().nullable(),
  accessIdentifier: z.string(),
  testResponseCount: z.number().int(),
  testTargetCount: z.number().int(),
  firstTestInviteCode: z.string().nullable(),
  completionTarget: z.number().int().nullable(),
  completedResponseCount: z.number().int(),
});

const get = authed
  .input(z.object({ surveyId: z.string() }))
  .output(ControlStateSchema.nullable())
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

// 전체 완료 목표 — 1 이상 정수 또는 null(해제). 0 은 받지 않는다: 「아무도 못 들어온다」는 중단의 일이다.
const setCompletionTarget = authed
  .input(
    z.object({
      surveyId: z.string(),
      completionTarget: z.number().int().min(1).max(10_000_000).nullable(),
    }),
  )
  .output(z.object({ completionTarget: z.number().int().nullable() }))
  .handler(({ input }) => svc.setCompletionTarget(input));

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

export const control = { get, setPaused, setCompletionTarget, setTestMode, disable };
