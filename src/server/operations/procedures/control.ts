import { ORPCError } from '@orpc/server';
import * as z from 'zod';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import * as svc from '../services/control';

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
  .output(ControlStateSchema.nullable())
  .handler(async ({ context, input }) => {
    // null 규약: 미저장 설문(빌더 헤더가 10초 폴링으로 상시 탄다)은 500 이 아니라 null 로
    // OFF 폴백한다. 관문의 NOT_FOUND(없거나 볼 수 없음 — 존재 은닉)도 같은 null 로 접는다.
    try {
      await assertSurveyCapabilityRpc(context.user, input.surveyId, 'operations.view');
    } catch (error) {
      if (error instanceof ORPCError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
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
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.setPaused({
      surveyId: input.surveyId,
      isPaused: input.isPaused,
      ...(input.pausedMessage !== undefined ? { pausedMessage: input.pausedMessage } : {}),
    });
  });

const setTestMode = authed
  .input(z.object({ surveyId: z.string(), enabled: z.literal(true) }))
  .output(ControlStateSchema)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.setTestMode(input);
  });

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
  .handler(async ({ context, input }) => {
    // 테스트 파티션 파괴(응답·조사 대상 삭제)를 포함한다 — 편집권 없는 설문에 열면
    // 아무 내부 계정이나 타 팀 설문의 테스트 워크스페이스를 지울 수 있다.
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.disableTestWorkspace(input);
  });

export const control = { get, setPaused, setTestMode, disable };
