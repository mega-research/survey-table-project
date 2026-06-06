import * as z from 'zod';

import { authed } from '@/server/orpc';

import {
  CreateBillingPeriodInput,
  DeleteLatestBillingPeriodInput,
} from '../../domain/mail-billing';
import * as svc from '../services/mail-billing.service';

/**
 * 요금제 행 등록.
 * 원본 action 이 data 미반환(ok-only) 이므로 output 도 ok-only 로 최소화.
 * createdBy 는 authed 컨텍스트의 user.id 를 service 로 주입.
 */
const create = authed
  .input(CreateBillingPeriodInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input, context }) => {
    await svc.createBillingPeriod(input, context.user.id);
    return { ok: true as const };
  });

/** 가장 최근 요금제 행 삭제. */
const deleteLatest = authed
  .input(DeleteLatestBillingPeriodInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.deleteLatestBillingPeriod(input.id);
    return { ok: true as const };
  });

export const billing = {
  create,
  deleteLatest,
};
