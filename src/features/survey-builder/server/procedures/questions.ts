import { authed } from '@/server/orpc';

import {
  CreateQuestionInput,
  DeleteQuestionInput,
  QuestionMutationOutput,
  QuestionRow,
  ReorderQuestionsInput,
  UpdateQuestionInput,
} from '../../domain/question';
import * as svc from '../services/questions.service';

const create = authed
  .input(CreateQuestionInput)
  .output(QuestionRow)
  .handler(({ input }) => svc.createQuestion(input));

const update = authed
  .input(UpdateQuestionInput)
  .output(QuestionRow)
  .handler(({ input }) => svc.updateQuestion(input.questionId, input.data));

// delete 는 예약어라 export 키도 codebase 컨벤션(remove)을 따른다.
const remove = authed
  .input(DeleteQuestionInput)
  .output(QuestionMutationOutput)
  .handler(({ input }) => svc.deleteQuestion(input.questionId));

const reorder = authed
  .input(ReorderQuestionsInput)
  .output(QuestionMutationOutput)
  .handler(({ input }) => svc.reorderQuestions(input.questionIds));

export const questions = {
  create,
  update,
  remove,
  reorder,
};
