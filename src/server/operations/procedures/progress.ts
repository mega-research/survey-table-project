import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  UpdateProgressColumnsInput,
  UpdateProgressColumnsResult,
} from '../domain/progress';
import * as svc from '../services/progress';

/**
 * 진척률 표 컬럼 갱신 — surveys 행의 설문 단위 설정 쓰기라 survey.edit 을 따른다
 * (리포트 화면을 여는 조회는 contacts.view). 표면의 view capability 로 쓰기를 지키면
 * 그 열을 갖게 될 실사원(티켓 24)이 팀 공용 설정에 닿는 잠복 경로가 된다.
 * 검증 실패도 throw 가 아니라 { ok:false, error } 로 그대로 통과 — 소비처가
 * result.ok / result.error 로 분기하므로 handler 에서 throw 하지 않는다.
 */
const updateColumns = authed
  .input(UpdateProgressColumnsInput)
  .output(UpdateProgressColumnsResult)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.updateProgressColumns(input);
  });

export const progress = {
  updateColumns,
};
