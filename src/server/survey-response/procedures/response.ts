import { ORPCError } from '@orpc/server';

import { resolveFieldworkProxy } from '@/server/fieldwork-proxy';
import { pub, withRateLimit } from '@/server/orpc';

import {
  CompleteResponseInput,
  CompleteResponseOutput,
  CreateBlankResponseInput,
  CreateResponseWithFirstAnswerInput,
  FirstAnswerResultSchema,
  SaveDraftResponseInput,
  SaveDraftResponseOutput,
  SurveyResponseRowSchema,
  UpdateQuestionResponseInput,
} from '../domain/response';
import * as core from '../services/response-answer-write';
import * as completion from '../services/response-completion';
import * as draft from '../services/response-draft';
import * as entry from '../services/response-entry';

// 회당 소수 호출 쓰기(생성/완료/updateAnswer)는 response-mutation 그룹으로 IP 당 rate limit 한다.
// saveDraft 는 고빈도 체크포인트라 별도 response-draft 버킷을 쓴다 — 같은 버킷이면
// 표 문항 연속 입력의 draft 폭주가 complete 예산을 소진해 제출까지 429 로 전멸한다.
const rateLimited = pub.use(withRateLimit('response-mutation'));
const draftRateLimited = pub.use(withRateLimit('response-draft'));

// 주의: response.start 는 제거됨(봇 방어). clientSignals/honeypot 을 받지 않는 무인증 빈 행
// 생성 경로라 봇 우회 표면이었고, 정상 클라이언트는 createWithFirstAnswer/createBlank 만 쓴다.
// 빈 응답 행이 필요한 notice-only 흐름은 createBlank 가 담당한다.

/**
 * 대리 응답 귀속을 세션에서 1회 파생한다 (티켓 27).
 *
 * **응답자 경로에는 비용이 없다** — 세션이 없거나 실사 계정이 아니면 코어가 DB 를 치지 않고
 * 곧바로 `none` 을 준다. 이 표면은 `pub` 이라 응답자 트래픽 전부가 지나므로 그 단락이 계약이다.
 *
 * 완료된 대상의 대행 진입은 **여기서 막는다.** 화면(.pen 10-2)도 「응답 완료」로 버튼을 지우고
 * 티켓 26 이 애초에 토큰을 안 주지만, 그 둘은 화면의 약속이라 서버가 다시 물어야 한다.
 * 응답자 본인에게는 적용되지 않는다 — 재응답 허용 설정은 종전 그대로다.
 */
async function proxyAttribution(
  user: Parameters<typeof resolveFieldworkProxy>[0],
  input: { surveyId: string; inviteToken?: string | undefined },
): Promise<string | null> {
  const proxy = await resolveFieldworkProxy(user, input.surveyId, input.inviteToken ?? null);
  if (proxy.kind === 'blocked') {
    throw new ORPCError('FORBIDDEN', { message: '이미 응답이 완료된 대상입니다.' });
  }
  return proxy.kind === 'proxy' ? proxy.fieldworkUserId : null;
}

/**
 * 질문 응답 업데이트(pub). jsonb_set 원자적 머지 + progress_pct 동기 갱신.
 */
const updateAnswer = rateLimited
  .input(UpdateQuestionResponseInput)
  .output(SurveyResponseRowSchema)
  .handler(({ input }) => core.updateQuestionResponse(input));

/**
 * 페이지 이동 전 변경 답변을 한 요청으로 저장한다.
 */
const saveDraft = draftRateLimited
  .input(SaveDraftResponseInput)
  .output(SaveDraftResponseOutput)
  .handler(async ({ input }) => {
    const result = await draft.saveDraftResponse(input);
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
  .handler(async ({ context, input }) =>
    entry.createResponseWithFirstAnswer(input, await proxyAttribution(context.user, input)),
  );

/**
 * 답변 없는 빈 응답 행 생성(pub). notice-only 등 silent data loss 방지 fallback.
 */
const createBlank = rateLimited
  .input(CreateBlankResponseInput)
  .output(FirstAnswerResultSchema)
  .handler(async ({ context, input }) =>
    entry.createBlankResponse(input, await proxyAttribution(context.user, input)),
  );

/**
 * 응답 완료(pub). JSONB + response_answers 이중 쓰기, prefill 재검증, 컨택 매칭 후처리.
 */
const complete = rateLimited
  .input(CompleteResponseInput)
  .output(CompleteResponseOutput)
  .handler(({ input }) => completion.completeResponse(input));

export const response = {
  updateAnswer,
  saveDraft,
  createWithFirstAnswer,
  createBlank,
  complete,
};
