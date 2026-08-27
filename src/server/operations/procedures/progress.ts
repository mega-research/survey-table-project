import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  UpdateProgressColumnsInput,
  UpdateProgressColumnsResult,
} from '../domain/progress';
import * as svc from '../services/progress';

/**
 * 진척률 표 컬럼 갱신 — 진척률 리포트는 컨택 attrs 를 행 단위로 그리는 표면이라
 * contacts.view 를 따른다.
 * 검증 실패도 throw 가 아니라 { ok:false, error } 로 그대로 통과 — 소비처가
 * result.ok / result.error 로 분기하므로 handler 에서 throw 하지 않는다.
 */
const updateColumns = authed
  .input(UpdateProgressColumnsInput)
  .output(UpdateProgressColumnsResult)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.view');
    return svc.updateProgressColumns(input);
  });

export const progress = {
  updateColumns,
};
