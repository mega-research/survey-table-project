
import { authed } from '@/server/orpc';

import {
  CreateQuestionInput,
  DeleteQuestionInput,
  QuestionMutationOutput,
  QuestionRow,
  ReorderQuestionsInput,
  UpdateQuestionInput,
} from '../domain/question';
import * as svc from '../services/questions';

const create = authed
  .input(CreateQuestionInput)
  .output(QuestionRow)
  .handler(({ input }) => svc.createQuestion(input));

const update = authed
  .input(UpdateQuestionInput)
  .output(QuestionRow)
  // 0행 매칭(존재하지 않는 질문)은 서비스가 NOT_FOUND 로 던진다.
  .handler(({ input }) => svc.updateQuestion(input.questionId, input.surveyId, input.data));

// delete 는 예약어라 export 키도 codebase 컨벤션(remove)을 따른다.
const remove = authed
  .input(DeleteQuestionInput)
  .output(QuestionMutationOutput)
  .handler(({ input }) => svc.deleteQuestion(input.questionId, input.surveyId));

const reorder = authed
  .input(ReorderQuestionsInput)
  .output(QuestionMutationOutput)
  .handler(({ input }) => svc.reorderQuestions(input.questionIds, input.surveyId));

export const questions = {
  create,
  update,
  remove,
  reorder,
};
