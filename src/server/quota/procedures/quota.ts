import * as z from 'zod';

import { authed, pub, withRateLimit } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import { QuotaCheckInput, QuotaCheckResult, QuotaConfigSchema } from '../domain/quota';
import { listQuotaAttrValues } from '../services/attr-values';
import * as svc from '../services/quota';

const get = authed
  .input(z.object({ surveyId: z.string() }))
  .output(QuotaConfigSchema.nullable())
  .handler(async ({ context, input }) => {
    // 쿼터 현황은 운영 콘솔 조회 표면 — operations.view 로 본다.
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'operations.view');
    return svc.getQuotaConfig(input.surveyId);
  });

const save = authed
  .input(z.object({ surveyId: z.string(), config: QuotaConfigSchema }))
  .output(QuotaConfigSchema)
  .handler(async ({ context, input }) => {
    // quotaConfig 는 publish 없이 응답자를 막는 라이브 강제 컬럼 — 설문 편집권으로 지킨다.
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.saveQuotaConfig(input.surveyId, input.config);
  });

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
  .handler(async ({ context, input }) => {
    // 쿼터 편집 화면의 조회 표면 — quota.get 과 같은 operations.view 로 본다.
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'operations.view');
    return listQuotaAttrValues(input.surveyId, input.attrKey);
  });

export const quota = { get, save, check, attrValues };
