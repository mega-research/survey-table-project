import * as z from 'zod';

import type { CampaignFilterSnapshot } from '@/db/schema/schema-types';

export type { CampaignFilterSnapshot };

/**
 * mail_campaigns.filter_snapshot — 마법사 ②단계 필터 조건 보존 스키마.
 * .strict() + clauses max20 + legacy 필드 포함은 원본 campaign-actions.ts 와 동일.
 * z.infer 가 schema-types.CampaignFilterSnapshot 와 호환되도록 모델링하되,
 * service 내부에서 as CampaignFilterSnapshot 캐스팅(원본 패턴 보존).
 */
export const FilterSnapshotSchema = z
  .object({
    clauses: z
      .array(
        z.object({
          source: z.string().max(200),
          value: z.string().max(500),
          op: z.enum(['AND', 'OR']).nullable(),
        }),
      )
      .max(20)
      .optional(),
    unrespondedOnly: z.boolean().optional(),
    unopenedFromCampaignId: z.string().uuid().optional(),
    unopenedAfterDays: z.number().int().min(0).max(365).optional(),
    // legacy (기존 저장 단체 메일 읽기 호환)
    qfield: z.enum(['all', 'resid', 'email', 'group', 'biz']).optional(),
    q: z.string().optional(),
    resultCodes: z.array(z.string()).optional(),
    groupValues: z.array(z.string()).optional(),
  })
  .strict();
export type FilterSnapshot = z.infer<typeof FilterSnapshotSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// createCampaign
// ─────────────────────────────────────────────────────────────────────────────

export const CreateCampaignInput = z.object({
  surveyId: z.string().uuid(),
  mailTemplateId: z.string().uuid(),
  title: z.string().min(1, '메일 제목을 입력하세요.').max(200),
  contactTargetIds: z
    .array(z.string().uuid())
    .min(1, '수신자를 1명 이상 선택하세요.')
    .max(10_000, '한 번에 최대 10,000명까지 발송 가능합니다.'),
  filterSnapshot: FilterSnapshotSchema.optional(),
});
export type CreateCampaignInput = z.infer<typeof CreateCampaignInput>;

export const CreateCampaignResult = z.object({
  campaignId: z.string(),
  queuedCount: z.number(),
  skippedCount: z.number(),
});
export type CreateCampaignResult = z.infer<typeof CreateCampaignResult>;

// ─────────────────────────────────────────────────────────────────────────────
// cancelCampaign
// ─────────────────────────────────────────────────────────────────────────────

export const CancelCampaignInput = z.object({
  surveyId: z.string().uuid(),
  campaignId: z.string().uuid(),
});
export type CancelCampaignInput = z.infer<typeof CancelCampaignInput>;

// ─────────────────────────────────────────────────────────────────────────────
// fetchCandidateIds
// ─────────────────────────────────────────────────────────────────────────────

export const FetchCandidateIdsInput = z.object({
  surveyId: z.string().uuid(),
  filter: FilterSnapshotSchema,
});
export type FetchCandidateIdsInput = z.infer<typeof FetchCandidateIdsInput>;

export const FetchCandidateIdsResult = z.object({
  ids: z.array(z.string()),
  total: z.number(),
  truncated: z.boolean(),
});
export type FetchCandidateIdsResult = z.infer<typeof FetchCandidateIdsResult>;

// ─────────────────────────────────────────────────────────────────────────────
// previewPreflight
// ─────────────────────────────────────────────────────────────────────────────

export const PreviewPreflightInput = z.object({
  surveyId: z.string().uuid(),
  selectedContactIds: z.array(z.string().uuid()).max(10_000),
});
export type PreviewPreflightInput = z.infer<typeof PreviewPreflightInput>;

export const PreviewPreflightResult = z.object({
  validCount: z.number(),
  unsubscribedCount: z.number(),
  excludedByCodeCount: z.number(),
  emailMissingCount: z.number(),
  bouncedCount: z.number(),
  notFoundCount: z.number(),
});
export type PreviewPreflightResult = z.infer<typeof PreviewPreflightResult>;
