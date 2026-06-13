import { authed } from '@/server/orpc';

import {
  CreateQuestionGroupInput,
  DeleteQuestionGroupInput,
  GroupMutationOutput,
  GroupRow,
  ReorderGroupsInput,
  UpdateQuestionGroupInput,
} from '../../domain/question-group';
import * as svc from '../services/question-groups.service';

const create = authed
  .input(CreateQuestionGroupInput)
  .output(GroupRow)
  .handler(({ input }) => svc.createQuestionGroup(input));

const update = authed
  .input(UpdateQuestionGroupInput)
  .output(GroupRow)
  .handler(({ input }) => svc.updateQuestionGroup(input.groupId, input.surveyId, input.data));

// delete 는 예약어라 export 키도 codebase 컨벤션(remove)을 따른다.
const remove = authed
  .input(DeleteQuestionGroupInput)
  .output(GroupMutationOutput)
  .handler(({ input }) => svc.deleteQuestionGroup(input.groupId, input.surveyId));

const reorder = authed
  .input(ReorderGroupsInput)
  .output(GroupMutationOutput)
  .handler(({ input }) => svc.reorderGroups(input.surveyId, input.groupIds));

export const groups = {
  create,
  update,
  remove,
  reorder,
};
