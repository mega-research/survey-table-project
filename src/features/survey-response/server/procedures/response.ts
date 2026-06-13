import { pub, withRateLimit } from '@/server/orpc';

import {
  CompleteResponseInput,
  CreateBlankResponseInput,
  CreateResponseWithFirstAnswerInput,
  FirstAnswerResultSchema,
  StartResponseInput,
  SurveyResponseRowSchema,
  UpdateQuestionResponseInput,
} from '../../domain/response';
import * as svc from '../services/response.service';

// 응답 쓰기 mutation 은 모두 response-mutation 그룹으로 IP 당 rate limit 한다.
const rateLimited = pub.use(withRateLimit('response-mutation'));

/**
 * 응답 시작(pub). 익명 응답자가 호출. 인증 미들웨어 불필요.
 */
const start = rateLimited
  .input(StartResponseInput)
  .output(SurveyResponseRowSchema)
  .handler(({ input }) => svc.startResponse(input));

/**
 * 질문 응답 업데이트(pub). jsonb_set 원자적 머지 + progress_pct 동기 갱신.
 */
const updateAnswer = rateLimited
  .input(UpdateQuestionResponseInput)
  .output(SurveyResponseRowSchema)
  .handler(({ input }) => svc.updateQuestionResponse(input));

/**
 * 첫 답변과 함께 응답 행 생성(pub). 중복 감지 재검증 후 created/blocked 반환.
 */
const createWithFirstAnswer = rateLimited
  .input(CreateResponseWithFirstAnswerInput)
  .output(FirstAnswerResultSchema)
  .handler(({ input }) => svc.createResponseWithFirstAnswer(input));

/**
 * 답변 없는 빈 응답 행 생성(pub). notice-only 등 silent data loss 방지 fallback.
 */
const createBlank = rateLimited
  .input(CreateBlankResponseInput)
  .output(FirstAnswerResultSchema)
  .handler(({ input }) => svc.createBlankResponse(input));

/**
 * 응답 완료(pub). JSONB + response_answers 이중 쓰기, prefill 재검증, 컨택 매칭 후처리.
 */
const complete = rateLimited
  .input(CompleteResponseInput)
  .output(SurveyResponseRowSchema)
  .handler(({ input }) => svc.completeResponse(input));

export const response = {
  start,
  updateAnswer,
  createWithFirstAnswer,
  createBlank,
  complete,
};
