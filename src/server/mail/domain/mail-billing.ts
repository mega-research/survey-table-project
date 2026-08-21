import * as z from 'zod';

import type { MailBillingPeriod } from '@/db/schema/mail-billing';

// 메일 비용 정산 요금제 행 타입 재노출.
export type { MailBillingPeriod };

/**
 * 요금제·결제일 행 등록 입력.
 * - startDate 의 day 가 결제일(billing_day_of_month)이 된다.
 * - day 1~28 범위 검증은 zod refine 이 아닌 service 레벨 throw 로 유지한다
 *   (원본 action 은 parse 성공 후 별도 if 로 검증 → ActionResult error 반환.
 *    refine 으로 옮기면 에러 코드/노출 시점이 달라져 소비처 catch 동작이 미묘히 바뀜).
 * - note 는 exactOptionalPropertyTypes 대응 위해 .optional() 만(원본과 동일).
 */
export const CreateBillingPeriodInput = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다.'),
  planLabel: z.string().trim().min(1, '요금제 라벨은 필수입니다.').max(60),
  monthlyFeeKrw: z.number().int().min(0).max(10_000_000_000),
  includedEmails: z.number().int().min(0).max(100_000_000),
  overagePer1kKrw: z.number().int().min(0).max(10_000_000),
  note: z.string().trim().max(500).optional(),
});
export type CreateBillingPeriodInput = z.infer<typeof CreateBillingPeriodInput>;

/** 가장 최근 요금제 행 삭제 입력. */
export const DeleteLatestBillingPeriodInput = z.object({
  id: z.string().uuid(),
});
export type DeleteLatestBillingPeriodInput = z.infer<
  typeof DeleteLatestBillingPeriodInput
>;
