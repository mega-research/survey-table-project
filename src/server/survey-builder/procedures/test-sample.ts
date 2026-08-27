import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  GetSurveyTestSampleInput,
  SurveyTestSampleSchema,
} from '../domain/test-sample';
import * as svc from '../services/test-sample';

/**
 * 빌더 토큰 미리보기용 첫 컨택 샘플.
 *
 * 관문이 두 단계다. `survey.view` 는 설문을 여는 자격이고, **실컨택 값을 돌려줄지는
 * `contacts.view` 가 정한다**(서비스가 판정). 예전에는 survey.view 하나로 첫 컨택의 attrs 와
 * resid 가 그대로 나갔는데, 팀 공개 설문의 일반 팀원은 survey.view 는 있어도 contacts.view 가
 * 없다 — 컨택 열람을 막아둔 매트릭스를 이 RPC 하나가 우회했다(Codex 적대적 리뷰).
 */
const get = authed
  .input(GetSurveyTestSampleInput)
  .output(SurveyTestSampleSchema.nullable())
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return svc.getSurveyTestSample(context.user, input.surveyId);
  });

export const testSample = {
  get,
};
