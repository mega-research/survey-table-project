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
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    try {
      return await svc.updateQuestion(input.questionId, input.surveyId, input.data);
    } catch (err) {
      if (err instanceof CrossSurveyRowError) rethrowCrossSurveyError(err);
      // 0행 매칭(존재하지 않는 질문) — generic Error는 oRPC가 Internal server error로
      // 마스킹해 원인 추적이 어려우므로 NOT_FOUND로 매핑한다.
      if (err instanceof Error && err.message === '질문 업데이트에 실패했습니다.') {
        throw new ORPCError('NOT_FOUND', {
          message: '질문을 찾을 수 없습니다. 설문을 먼저 저장한 뒤 다시 시도하세요.',
        });
      }
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
