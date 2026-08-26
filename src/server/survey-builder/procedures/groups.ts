import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  CreateQuestionGroupInput,
  DeleteQuestionGroupInput,
  GroupMutationOutput,
  GroupRow,
  ReorderGroupsInput,
  UpdateQuestionGroupInput,
} from '../domain/question-group';
import * as svc from '../services/question-groups';

// 그룹 mutation 은 전부 설문 편집이다 — handler 첫 줄에서 survey.edit 관문을 지난다(티켓 09).

const create = authed
  .input(CreateQuestionGroupInput)
  .output(GroupRow)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.createQuestionGroup(input);
  });

const update = authed
  .input(UpdateQuestionGroupInput)
  .output(GroupRow)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.updateQuestionGroup(input.groupId, input.surveyId, input.data);
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
    return svc.reorderGroups(input.surveyId, input.groupIds);
  });

export const groups = {
  create,
  update,
  remove,
  reorder,
};
