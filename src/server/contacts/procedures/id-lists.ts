import { assertSurveyWriteAccessInShare, scoped } from '@/server/orpc';

import { CreateContactIdListInput, CreateContactIdListOutput } from '../domain/contact-id-list';
import * as svc from '../services/contact-id-lists';

/**
 * 필터 붙여넣기 대용량 경로 — 인라인 상한(2,000)을 넘는 ID 목록을 저장하고 토큰 재료를 돌려준다.
 * 컨택 목록·메일 위저드는 게스트 grant 콘솔 표면이므로 scoped + assertSurveyAccess
 * (attrValues 와 동일 패턴).
 */
const create = scoped
  .input(CreateContactIdListInput)
  .output(CreateContactIdListOutput)
  .handler(async ({ input, context }) => {
    // 담당 범위에 묶인 게스트에게도 연다 — 번호 목록을 저장할 뿐 대상을 읽지 않는다(읽는 쪽인 목록 해석이
    // 범위를 건다). 돌려받은 범위는 쓸 자리가 없다.
    assertSurveyWriteAccessInShare(context.user.id, input.surveyId);
    return svc.createContactIdList({ ...input, createdBy: context.user.id });
  });

export const idLists = {
  create,
};
