import { scoped } from '@/server/orpc';
import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';

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
    await assertScopedSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.view');
    return svc.createContactIdList({ ...input, createdBy: context.user.id });
  });

export const idLists = {
  create,
};
