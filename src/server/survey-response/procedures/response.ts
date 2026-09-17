import { ORPCError } from '@orpc/server';

import { stampFieldworkAttribution } from '@/server/fieldwork-proxy';
import { pub, withRateLimit } from '@/server/orpc';
import { resolveProxyForResponseRpc } from '@/server/rpc-fieldwork-proxy';

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
import { TestResponseVersionPrunedError } from '../services/response-version-snapshot';

// 회당 소수 호출 쓰기(생성/완료/updateAnswer)는 response-mutation 그룹으로 IP 당 rate limit 한다.
// saveDraft 는 고빈도 체크포인트라 별도 response-draft 버킷을 쓴다 — 같은 버킷이면
// 표 문항 연속 입력의 draft 폭주가 complete 예산을 소진해 제출까지 429 로 전멸한다.
const rateLimited = pub.use(withRateLimit('response-mutation'));
const draftRateLimited = pub.use(withRateLimit('response-draft'));

/**
 * 테스트 도중 재발행으로 응답 버전 스냅샷이 비워진 경우 — 500 대신 코드 있는 거부로 접어
 * 응답 화면이 "새로 시작" 안내를 띄우게 한다. 코드 있는 ORPCError 라 Sentry 로 가지 않는다.
 */
const TEST_VERSION_REPUBLISHED_CODE = 'TEST_VERSION_REPUBLISHED';

function mapTestVersionPruned(err: unknown): never {
  if (err instanceof TestResponseVersionPrunedError) {
    throw new ORPCError(TEST_VERSION_REPUBLISHED_CODE, { status: 409, message: err.message });
  }
  throw err;
}

// 주의: response.start 는 제거됨(봇 방어). clientSignals/honeypot 을 받지 않는 무인증 빈 행
// 생성 경로라 봇 우회 표면이었고, 정상 클라이언트는 createWithFirstAnswer/createBlank 만 쓴다.
// 빈 응답 행이 필요한 notice-only 흐름은 createBlank 가 담당한다.

/**
 * 대행이면 확정된 행에 귀속을 찍는다 (티켓 27).
 *
 * **행 id 가 나온 뒤에 찍는 것**이 요점이다. 진입 서비스에 인자로 흘려보내면 그 안의 분기
 * (기존 행 물려받기·버전 이관·테스트 lane)마다 챙겨야 하고, 실제로 셋을 놓쳤다. 여기서는
 * 어떤 분기를 지나왔든 결과에 id 가 있으면 찍힌다.
 *
 * **응답자 경로에는 비용이 없다** — 코어가 세션 없음·비실사에서 DB 를 치지 않고 곧바로
 * `none` 을 주고, 그러면 stamp 도 아무것도 하지 않는다.
 *
 * 완료된 대상의 대행 진입은 어댑터가 FORBIDDEN 으로 막는다. 화면(.pen 10-2)이 버튼을 지우고
 * 티켓 26 이 애초에 토큰을 안 주지만 그 둘은 화면의 약속이라 서버가 다시 물어야 한다.
 * 응답자 본인에게는 적용되지 않는다 — 재응답 허용 설정은 종전 그대로다.
 */
async function withProxyAttribution<T extends { kind: string; id?: string }>(
  user: Parameters<typeof resolveProxyForResponseRpc>[0],
  input: { surveyId: string; inviteToken?: string | undefined },
  run: () => Promise<T>,
): Promise<T> {
  const proxy = await resolveProxyForResponseRpc(user, input.surveyId, input.inviteToken ?? null);
  const result = await run();
  if (result.id) await stampFieldworkAttribution(result.id, proxy);
  return result;
}

/**
 * 질문 응답 업데이트(pub). jsonb_set 원자적 머지 + progress_pct 동기 갱신.
 */
const updateAnswer = rateLimited
  .input(UpdateQuestionResponseInput)
  .output(SurveyResponseRowSchema)
  .handler(({ input }) => core.updateQuestionResponse(input).catch(mapTestVersionPruned));

/**
 * 페이지 이동 전 변경 답변을 한 요청으로 저장한다.
 */
const saveDraft = draftRateLimited
  .input(SaveDraftResponseInput)
  .output(SaveDraftResponseOutput)
  .handler(async ({ input }) => {
    const result = await draft.saveDraftResponse(input).catch(mapTestVersionPruned);
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
  .handler(({ context, input }) =>
    withProxyAttribution(context.user, input, () => entry.createResponseWithFirstAnswer(input)),
  );

/**
 * 답변 없는 빈 응답 행 생성(pub). notice-only 등 silent data loss 방지 fallback.
 */
const createBlank = rateLimited
  .input(CreateBlankResponseInput)
  .output(FirstAnswerResultSchema)
  .handler(({ context, input }) =>
    withProxyAttribution(context.user, input, () => entry.createBlankResponse(input)),
  );

/**
 * 응답 완료(pub). JSONB + response_answers 이중 쓰기, prefill 재검증, 컨택 매칭 후처리.
 */
const complete = rateLimited
  .input(CompleteResponseInput)
  .output(CompleteResponseOutput)
  .handler(({ input }) => completion.completeResponse(input).catch(mapTestVersionPruned));

export const response = {
  updateAnswer,
  saveDraft,
  createWithFirstAnswer,
  createBlank,
  complete,
};
