import { scoped } from '@/server/orpc';
import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { accountUserIdOf } from '@/server/survey-access';

import { CreateContactIdListInput, CreateContactIdListOutput } from '../domain/contact-id-list';
import * as svc from '../services/contact-id-lists';

/**
 * 필터 붙여넣기 대용량 경로 — 인라인 상한(2,000)을 넘는 ID 목록을 저장하고 토큰 재료를 돌려준다.
 * 컨택 목록·메일 위저드의 필터라 scoped + contacts.view 관문(attrValues 와 동일 패턴).
 */
const create = scoped
  .input(CreateContactIdListInput)
  .output(CreateContactIdListOutput)
  .handler(async ({ input, context }) => {
    await assertScopedSurveyCapabilityRpc(context.actor, input.surveyId, 'contacts.view');
    // 링크가 만든 목록은 작성자 칸이 빈다 — 그 칸은 계정 FK 이고 링크는 계정이 아니다.
    return svc.createContactIdList({ ...input, createdBy: accountUserIdOf(context.actor) });
  });

export const idLists = {
  create,
};
