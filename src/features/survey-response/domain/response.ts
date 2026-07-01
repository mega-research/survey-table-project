import * as z from 'zod';

import type { SurveyResponse } from '@/db/schema';
import type { BlockReason, ClientSignals } from '@/lib/duplicate-detection/types';

export type { SurveyResponse, BlockReason, ClientSignals };

/**
 * 클라이언트 신호. lib/duplicate-detection/types.ts 의 ClientSignals 형태를 그대로 모델링.
 * deviceId 는 nullable (LocalStorage 차단/시크릿 모드 시 null), 나머지는 문자열.
 * z.infer 가 ClientSignals 와 호환되도록 필드를 명시한다.
 */
export const ClientSignalsSchema = z.object({
  deviceId: z.string().nullable(),
  screen: z.string(),
  tz: z.string(),
  lang: z.string(),
  platform: z.string(),
});

/**
 * 질문 응답값 맵(JSONB). 응답값은 text/array/object 등 다형이라 unknown 으로 유지.
 * 원본 시그니처(Record<string, unknown>) 그대로 보존 — 과도한 스키마화는 회귀 위험.
 */
export const QuestionResponsesSchema = z.record(z.string(), z.unknown());

/**
 * 응답 행 output. surveyResponses.$inferSelect 전체를 z.custom 으로 타입만 보장(런타임 통과).
 * .returning() 전체 행을 그대로 통과시키는 원본 동작 보존.
 */
export const SurveyResponseRowSchema = z.custom<SurveyResponse>();

// ─────────────────────────────────────────────────────────────────────────────
// startResponse
// ─────────────────────────────────────────────────────────────────────────────

export const StartResponseInput = z.object({
  surveyId: z.string(),
  sessionId: z.string().optional(),
  versionId: z.string().optional(),
});
export type StartResponseInput = z.infer<typeof StartResponseInput>;

// ─────────────────────────────────────────────────────────────────────────────
// updateQuestionResponse
// ─────────────────────────────────────────────────────────────────────────────

export const UpdateQuestionResponseInput = z.object({
  responseId: z.string(),
  questionId: z.string(),
  value: z.unknown(),
});
export type UpdateQuestionResponseInput = z.infer<typeof UpdateQuestionResponseInput>;

// ─────────────────────────────────────────────────────────────────────────────
// createResponseWithFirstAnswer / createBlankResponse
// ─────────────────────────────────────────────────────────────────────────────

export const CreateResponseWithFirstAnswerInput = z.object({
  surveyId: z.string(),
  sessionId: z.string(),
  versionId: z.string().nullable(),
  questionId: z.string(),
  value: z.unknown(),
  currentStepId: z.string(),
  // 운영 콘솔 진척 표기용 visible step 진척 (클라 계산값). 미전송/구 클라 호환 위해 nullish.
  visibleStepIndex: z.number().int().nullish(),
  visibleStepTotal: z.number().int().nullish(),
  inviteToken: z.string().optional(),
  // null 이면 신호 기반 검사 skip — LocalStorage 차단 등 클라이언트 신호 수집 실패 시 null 그대로
  clientSignals: ClientSignalsSchema.nullable(),
  // 봇 방어 허니팟. 실제 클라이언트는 hidden 필드라 항상 빈 값. 봇이 채우면 차단.
  honeypot: z.string().optional(),
});
export type CreateResponseWithFirstAnswerInput = z.infer<
  typeof CreateResponseWithFirstAnswerInput
>;

export const CreateBlankResponseInput = z.object({
  surveyId: z.string(),
  sessionId: z.string(),
  versionId: z.string().nullable(),
  currentStepId: z.string(),
  inviteToken: z.string().optional(),
  clientSignals: ClientSignalsSchema.nullable(),
  // 봇 방어 허니팟. 실제 클라이언트는 hidden 필드라 항상 빈 값. 봇이 채우면 차단.
  honeypot: z.string().optional(),
});
export type CreateBlankResponseInput = z.infer<typeof CreateBlankResponseInput>;

/**
 * createResponseWithFirstAnswer / createBlankResponse 의 반환.
 * - created: 응답 행 생성/재사용 성공 (id + contactTargetId)
 * - blocked: 중복 감지로 차단 (BlockReason)
 * BlockReason 은 lib/duplicate-detection/types.ts 의 union 을 z.enum 으로 그대로 모델링.
 */
export const BlockReasonSchema = z.enum([
  'invalid_token',
  'token_already_used',
  'device_already_responded',
  'excluded_from_population',
  'quota_closed',
]);

export const FirstAnswerResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('created'),
    id: z.string(),
    contactTargetId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('blocked'),
    reason: BlockReasonSchema,
  }),
]);
export type FirstAnswerResult = z.infer<typeof FirstAnswerResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// completeResponse
// ─────────────────────────────────────────────────────────────────────────────

export const CompleteResponseInput = z.object({
  responseId: z.string(),
  data: z
    .object({
      questionResponses: QuestionResponsesSchema.optional(),
      exposedQuestionIds: z.array(z.string()).optional(),
      exposedRowIds: z.array(z.string()).optional(),
    })
    .optional(),
});
export type CompleteResponseInput = z.infer<typeof CompleteResponseInput>;
