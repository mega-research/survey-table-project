import * as z from 'zod';

import type { QuotaConfig } from '@/db/schema/schema-types';

export const QuotaCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  values: z.array(z.string()).optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
});

export const QuotaDimensionSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  label: z.string(),
  kind: z.enum(['choice', 'numeric']),
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
  closedMessage: z.string().nullable(),
});
