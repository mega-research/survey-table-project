import * as z from 'zod';

import { authed, pub, withRateLimit } from '@/server/orpc';

import { QuotaCheckInput, QuotaCheckResult, QuotaConfigSchema } from '../domain/quota';
import { listQuotaAttrValues } from '../services/attr-values';
import * as svc from '../services/quota';

const get = authed
  .input(z.object({ surveyId: z.string() }))
  .output(QuotaConfigSchema.nullable())
  .handler(({ input }) => svc.getQuotaConfig(input.surveyId));

const save = authed
  .input(z.object({ surveyId: z.string(), config: QuotaConfigSchema }))
  .output(QuotaConfigSchema)
  .handler(({ input }) => svc.saveQuotaConfig(input.surveyId, input.config));

// 쿼터 판정은 전용 quota-check 버킷을 쓴다. 클라이언트가 429 를 fail-open 처리하는
// 조회라, 공유 버킷(lookup)이 NAT 진입 트래픽으로 소진되면 쿼터 판정이 조용히
// 스킵된다 — 전용 예산 + responseId 클라이언트 축(입력에 포함)으로 격리한다.
const check = pub
  .use(withRateLimit('quota-check'))
  .input(QuotaCheckInput)
  .output(QuotaCheckResult)
  .handler(({ input }) => svc.checkQuota(input));

// 속성형 차원의 카테고리 초안 — 명단 attrs 열의 고유 값. pii 는 attrs 에 없어 읽히지 않는다.
const attrValues = authed
  .input(z.object({ surveyId: z.string(), attrKey: z.string().min(1) }))
  .output(z.object({ values: z.array(z.string()), truncated: z.boolean() }))
  .handler(({ input }) => listQuotaAttrValues(input.surveyId, input.attrKey));

export const quota = { get, save, check, attrValues };
