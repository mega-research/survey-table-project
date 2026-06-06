import * as z from 'zod';

/**
 * 어드민 응답 관리(soft delete / restore / hard reset) 도메인 스키마.
 *
 * 세 동작 모두 (surveyId, responseId) 2중 식별자만 받는다. shape 이 동일하지만
 * 향후 분기/명확성을 위해 별도 스키마로 노출한다.
 * surveyId/responseId 는 기존 server action 과 동일하게 형식 검증 없이 받는다 —
 * 잘못된 조합은 변경 0행 + ok:true 로 fail-soft 동작을 보존.
 */
export const SoftDeleteResponseInput = z.object({
  surveyId: z.string(),
  responseId: z.string(),
});
export type SoftDeleteResponseInput = z.infer<typeof SoftDeleteResponseInput>;

export const RestoreResponseInput = z.object({
  surveyId: z.string(),
  responseId: z.string(),
});
export type RestoreResponseInput = z.infer<typeof RestoreResponseInput>;

export const HardResetResponseInput = z.object({
  surveyId: z.string(),
  responseId: z.string(),
});
export type HardResetResponseInput = z.infer<typeof HardResetResponseInput>;

/** 세 관리 동작 공통 출력 */
export const ResponseManageOutput = z.object({ ok: z.literal(true) });
export type ResponseManageOutput = z.infer<typeof ResponseManageOutput>;
