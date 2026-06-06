import * as z from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// recordStepVisit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 페이지 이동(스텝 전환) 기록 input.
 * 원본 시그니처(responseId/nextStepId) 그대로 보존.
 */
export const RecordStepVisitInput = z.object({
  responseId: z.string(),
  nextStepId: z.string(),
});
export type RecordStepVisitInput = z.infer<typeof RecordStepVisitInput>;

// ─────────────────────────────────────────────────────────────────────────────
// recordVisibilitySegment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Page Visibility 세그먼트 기록 input (sendBeacon 대상).
 * action 은 'hide' | 'show' 두 값만 허용.
 */
export const RecordVisibilitySegmentInput = z.object({
  responseId: z.string(),
  action: z.enum(['hide', 'show']),
});
export type RecordVisibilitySegmentInput = z.infer<typeof RecordVisibilitySegmentInput>;

// ─────────────────────────────────────────────────────────────────────────────
// resumeOrCreateResponse
// ─────────────────────────────────────────────────────────────────────────────

export const ResumeOrCreateResponseInput = z.object({
  surveyId: z.string(),
  sessionId: z.string(),
  inviteToken: z.string().optional(),
});
export type ResumeOrCreateResponseInput = z.infer<typeof ResumeOrCreateResponseInput>;

/**
 * resumeOrCreateResponse 반환 status. survey_responses.status 의 6개 값 그대로 모델링.
 * 원본 시그니처의 union ('in_progress' | 'completed' | 'screened_out' | 'quotaful_out'
 * | 'bad' | 'drop') 을 z.enum 으로 보존.
 */
export const ResumeStatusSchema = z.enum([
  'in_progress',
  'completed',
  'screened_out',
  'quotaful_out',
  'bad',
  'drop',
]);

/**
 * resumeOrCreateResponse 반환.
 * - 기존 응답이 있으면 { id, status, resumed }
 * - 첫 진입(매칭 행 없음) 또는 알 수 없는 status 면 null
 * 원본의 `... | null` 시그니처를 .nullable() 로 보존.
 */
export const ResumeOrCreateResponseOutput = z
  .object({
    id: z.string(),
    status: ResumeStatusSchema,
    resumed: z.boolean(),
  })
  .nullable();
export type ResumeOrCreateResponseOutput = z.infer<typeof ResumeOrCreateResponseOutput>;
