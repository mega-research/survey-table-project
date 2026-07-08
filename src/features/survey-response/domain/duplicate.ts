import * as z from 'zod';

import type {
  BlockReason,
  CheckResult,
  ClientSignals,
} from '@/lib/duplicate-detection/types';

export type { BlockReason, CheckResult, ClientSignals };

/**
 * 클라이언트 신호. lib/duplicate-detection/types.ts 의 ClientSignals 형태를 그대로 모델링.
 * deviceId 는 nullable (LocalStorage 차단/시크릿 모드 시 null), 나머지는 문자열.
 * domain/response.ts 의 ClientSignalsSchema 와 동일 형태.
 */
export const ClientSignalsSchema = z.object({
  deviceId: z.string().nullable(),
  screen: z.string(),
  tz: z.string(),
  lang: z.string(),
  platform: z.string(),
});

// ─────────────────────────────────────────────────────────────────────────────
// checkDuplicateOnEntry
// ─────────────────────────────────────────────────────────────────────────────

export const CheckDuplicateOnEntryInput = z.object({
  surveyId: z.string(),
  inviteToken: z.string().optional(),
  // null 이면 클라이언트 신호 수집 실패 — Track B skip (통과 처리)
  clientSignals: ClientSignalsSchema.nullable(),
});
export type CheckDuplicateOnEntryInput = z.infer<typeof CheckDuplicateOnEntryInput>;

/**
 * BlockReason 은 lib/duplicate-detection/types.ts 의 union 을 z.enum 으로 그대로 모델링.
 */
export const BlockReasonSchema = z.enum([
  'invalid_token',
  'token_already_used',
  'device_already_responded',
  'excluded_from_population',
  'quota_closed',
  'survey_paused',
  'invalid_test_token',
]);

/**
 * checkDuplicateOnEntry 반환. lib 의 CheckResult union 을 그대로 모델링.
 * - blocked: true → reason 동봉
 * - blocked: false → Track A 통과 시 contactTargetId(optional) 동봉
 */
export const CheckResultSchema = z.union([
  z.object({
    blocked: z.literal(true),
    reason: BlockReasonSchema,
  }),
  z.object({
    blocked: z.literal(false),
    contactTargetId: z.string().optional(),
  }),
]);
export type CheckResultOutput = z.infer<typeof CheckResultSchema>;
