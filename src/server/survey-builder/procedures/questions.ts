import { ORPCError } from '@orpc/server';
import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  CreateQuestionInput,
  DeleteQuestionInput,
  QuestionMutationOutput,
  QuestionRow,
  ReorderQuestionsInput,
  UpdateQuestionInput,
} from '../domain/question';
import { CrossSurveyRowError } from '../domain/survey-save';
import * as svc from '../services/questions';

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

// 질문 mutation 은 전부 설문 편집이다 — handler 첫 줄에서 survey.edit 관문을 지난다(티켓 09).

const create = authed
  .input(CreateQuestionInput)
  .output(QuestionRow)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.createQuestion(input).catch(rethrowCrossSurveyError);
  });

const update = authed
  .input(UpdateQuestionInput)
  .output(QuestionRow)
  // 0행 매칭(존재하지 않는 질문)은 서비스가 NOT_FOUND 로 던진다.
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    try {
      return await svc.updateQuestion(input.questionId, input.surveyId, input.data);
    } catch (err) {
      if (err instanceof CrossSurveyRowError) rethrowCrossSurveyError(err);
      throw err;
    }
  });

// delete 는 예약어라 export 키도 codebase 컨벤션(remove)을 따른다.
const remove = authed
  .input(DeleteQuestionInput)
  .output(QuestionMutationOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.deleteQuestion(input.questionId, input.surveyId);
  });

const reorder = authed
  .input(ReorderQuestionsInput)
  .output(QuestionMutationOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.reorderQuestions(input.questionIds, input.surveyId).catch(rethrowCrossSurveyError);
  });

export const questions = {
  create,
  update,
  remove,
  reorder,
};
