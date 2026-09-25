import * as z from 'zod';

import { QUOTA_DIMENSION_KINDS, type QuotaConfig } from '@/shared/contracts/quota';

export const QuotaCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  values: z.array(z.string()).optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  keywords: z.array(z.string()).optional(),
  isElse: z.boolean().optional(),
});

export const QuotaDimensionSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  label: z.string(),
  kind: z.enum(QUOTA_DIMENSION_KINDS),
  attrKey: z.string().optional(),
  cellIds: z.array(z.string()).optional(),
  categories: z.array(QuotaCategorySchema),
});

export const QuotaCellSchema = z.object({
  categoryIds: z.array(z.string()),
  target: z.number().int().min(0),
});

export const QuotaConfigSchema = z.object({
  enabled: z.boolean(),
  dimensions: z.array(QuotaDimensionSchema),
  cells: z.array(QuotaCellSchema),
  closedMessage: z.string().nullable(),
  midSurveyClose: z.boolean().optional(),
  midSurveyClosedMessage: z.string().nullable().optional(),
});

// zod 추론 타입이 drizzle 타입(QuotaConfig)과 정합함을 컴파일 타임에 보장.
// 한쪽만 바뀌면 여기서 타입 에러가 난다.
type _InferMatchesDrizzle = z.infer<typeof QuotaConfigSchema> extends QuotaConfig ? true : never;
type _DrizzleMatchesInfer = QuotaConfig extends z.infer<typeof QuotaConfigSchema> ? true : never;
const _c1: _InferMatchesDrizzle = true;
const _c2: _DrizzleMatchesInfer = true;
void _c1;
void _c2;

export const QuotaCheckInput = z.object({
  responseId: z.string(),
  surveyId: z.string(),
  answers: z.record(z.string(), z.unknown()),
});

export const QuotaCheckResult = z.object({
  blocked: z.boolean(),
  /** 입장 판정에서 막힌 응답자에게 보이는 문구(플랜의 마감 문구, null 이면 화면 기본 문구). */
  closedMessage: z.string().nullable(),
  /**
   * 입장 뒤(페이지 재확인)에 막힌 응답자에게 보이는 문구 — 진행 중 마감 문구, 비면 마감 문구.
   * 어느 단계에서 막혔는지는 클라이언트가 안다(첫 판정인지 재확인인지). blocked 일 때만 실린다.
   */
  midSurveyClosedMessage: z.string().nullable().optional(),
});
