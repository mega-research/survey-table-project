import { ORPCError } from '@orpc/server';
import * as z from 'zod';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import { SurveyNotClosableError } from '../domain/survey-close';
import * as svc from '../services/control';

const ControlStateSchema = z.object({
  isPaused: z.boolean(),
  pausedMessage: z.string().nullable(),
  isClosed: z.boolean(),
  testModeEnabled: z.boolean(),
  testViewInBrowser: z.boolean(),
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

/**
 * 설문 종료·종료 취소 (ADR-0030).
 *
 * capability 가 중단과 같은 `survey.edit` 인 것이 계약이다 — 갈리면 「중단은 되는데 종료는
 * 안 되는」 사람이 생겨 스위치가 둘인 이유가 흐려진다. 외부 접근을 끊는 방향이라 넓게 줘도
 * 위험하지 않다.
 */
const setClosed = authed
  .input(z.object({ surveyId: z.string(), isClosed: z.boolean() }))
  .output(z.object({ isClosed: z.boolean() }))
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    try {
      return await svc.setClosed(input);
    } catch (error) {
      // 문자열 Error 로 두면 rpc-error-policy 가 500 으로 마스킹해, 정확히 거부된 요청이
      // 화면에는 「내부 오류」로 보인다.
      if (error instanceof SurveyNotClosableError) {
        throw new ORPCError('CONFLICT', { message: error.message });
      }
      throw error;
    }
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

export const control = { get, setPaused, setClosed, setTestMode, disable };
