import { pub, withRateLimit } from '@/server/orpc';

import {
  CompleteResponseInput,
  CreateBlankResponseInput,
  CreateResponseWithFirstAnswerInput,
  FirstAnswerResultSchema,
  SaveDraftResponseInput,
  SaveDraftResponseOutput,
  SurveyResponseRowSchema,
  UpdateQuestionResponseInput,
  CompleteResponseOutput,
} from '../domain/response';
import * as svc from '../services/response.service';

// 회당 소수 호출 쓰기(생성/완료/updateAnswer)는 response-mutation 그룹으로 IP 당 rate limit 한다.
// saveDraft 는 고빈도 체크포인트라 별도 response-draft 버킷을 쓴다 — 같은 버킷이면
// 표 문항 연속 입력의 draft 폭주가 complete 예산을 소진해 제출까지 429 로 전멸한다.
const rateLimited = pub.use(withRateLimit('response-mutation'));
const draftRateLimited = pub.use(withRateLimit('response-draft'));

// 주의: response.start 는 제거됨(봇 방어). clientSignals/honeypot 을 받지 않는 무인증 빈 행
// 생성 경로라 봇 우회 표면이었고, 정상 클라이언트는 createWithFirstAnswer/createBlank 만 쓴다.
// 빈 응답 행이 필요한 notice-only 흐름은 createBlank 가 담당한다.

/**
 * 질문 응답 업데이트(pub). jsonb_set 원자적 머지 + progress_pct 동기 갱신.
 */
const updateAnswer = rateLimited
  .input(UpdateQuestionResponseInput)
  .output(SurveyResponseRowSchema)
  .handler(({ input }) => svc.updateQuestionResponse(input));

/**
 * 페이지 이동 전 변경 답변을 한 요청으로 저장한다.
 */
const saveDraft = draftRateLimited
  .input(SaveDraftResponseInput)
  .output(SaveDraftResponseOutput)
  .handler(async ({ input }) => {
    const result = await svc.saveDraftResponse(input);
    return {
      ok: true as const,
      applied: result.applied,
      ...(result.concluded ? { concluded: true } : {}),
    };
  });

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
  .output(CompleteResponseOutput)
  .handler(({ input }) => svc.completeResponse(input));

export const response = {
  updateAnswer,
  saveDraft,
  createWithFirstAnswer,
  createBlank,
  complete,
};
