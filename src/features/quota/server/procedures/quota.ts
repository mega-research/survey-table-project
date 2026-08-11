import * as z from 'zod';

import { authed, pub, withRateLimit } from '@/server/orpc';

import { QuotaCheckInput, QuotaCheckResult, QuotaConfigSchema } from '../../domain/quota';
import * as svc from '../services/quota.service';

const get = authed
  .input(z.object({ surveyId: z.string() }))
  .output(QuotaConfigSchema.nullable())
  .handler(({ input }) => svc.getQuotaConfig(input.surveyId));

const save = authed
  .input(z.object({ surveyId: z.string(), config: QuotaConfigSchema }))
  .output(QuotaConfigSchema)
  .handler(({ input }) => svc.saveQuotaConfig(input.surveyId, input.config));

// 쿼터 판정은 읽기 전용 조회라 lookup 버킷을 쓴다 — response-mutation 에 두면
// 세션당 1회뿐인 이 호출도 complete 와 같은 예산을 잠식한다.
const check = pub
  .use(withRateLimit('lookup'))
  .input(QuotaCheckInput)
  .output(QuotaCheckResult)
  .handler(({ input }) => svc.checkQuota(input));

export const quota = { get, save, check };
