import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import { CrossSurveyRowError } from '../domain/survey-save';

import {
  CreateQuestionGroupInput,
  DeleteQuestionGroupInput,
  GroupMutationOutput,
  GroupRow,
  ReorderGroupsInput,
  UpdateQuestionGroupInput,
} from '../domain/question-group';
import * as svc from '../services/question-groups';

/**
 * 타 설문 그룹 참조 거부를 RPC 어휘로 옮긴다 (티켓 15).
 *
 * 서비스가 던지는 CrossSurveyRowError 는 save 표면과 같은 사유·같은 코드여야 한다 —
 * 매핑을 빠뜨리면 rpc-error-policy 가 500 으로 마스킹해 화면이 아무 문구도 못 띄운다.
 */
function rethrowCrossSurveyError(error: unknown): never {
  if (error instanceof CrossSurveyRowError) {
    throw new ORPCError('FORBIDDEN', { message: error.message });
  }
  throw error;
}

// 그룹 mutation 은 전부 설문 편집이다 — handler 첫 줄에서 survey.edit 관문을 지난다(티켓 09).

const create = authed
  .input(CreateQuestionGroupInput)
  .output(GroupRow)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.createQuestionGroup(input).catch(rethrowCrossSurveyError);
  });

const update = authed
  .input(UpdateQuestionGroupInput)
  .output(GroupRow)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc
      .updateQuestionGroup(input.groupId, input.surveyId, input.data)
      .catch(rethrowCrossSurveyError);
  });

// delete 는 예약어라 export 키도 codebase 컨벤션(remove)을 따른다.
const remove = authed
  .input(DeleteQuestionGroupInput)
  .output(GroupMutationOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.deleteQuestionGroup(input.groupId, input.surveyId);
  });

const reorder = authed
  .input(ReorderGroupsInput)
  .output(GroupMutationOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.reorderGroups(input.surveyId, input.groupIds).catch(rethrowCrossSurveyError);
  });

export const groups = {
  create,
  update,
  remove,
  reorder,
};
