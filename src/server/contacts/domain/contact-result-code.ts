import * as z from 'zod';

import type { ContactResultCode } from '@/shared/contracts/contacts';

// 결과코드 1개 정의(JSONB 항목) 타입 재노출.
export type { ContactResultCode };

/** 복잡 JSONB 항목은 z.custom 으로 타입만 보장(런타임 통과). */
export const ContactResultCodeSchema = z.custom<ContactResultCode>();

/**
 * 결과코드 set 갱신 입력.
 * - codes 가 null 이면 surveys.contact_result_codes 를 NULL 로 set →
 *   읽기 측에서 DEFAULT_RESULT_CODES 로 폴백(기본 코드셋 복귀 의미).
 * - 빈 배열 reject(최소 1개) 검증은 service 레벨 throw 로 유지(기존 action 동작 보존,
 *   zod refine 로 옮기면 에러 코드/노출 시점이 달라져 소비처 catch 동작이 미묘히 바뀜).
 */
export const UpdateResultCodesInput = z.object({
  surveyId: z.string(),
  codes: z.array(ContactResultCodeSchema).nullable(),
});
export type UpdateResultCodesInput = z.infer<typeof UpdateResultCodesInput>;
