import * as z from 'zod';

import type { SurveyResponse } from '@/db/schema';
import type { BlockReason, ClientSignals } from '@/lib/duplicate-detection/types';
import type { TestAttemptIdentity } from '@/shared/types/test-attempt';

export type { SurveyResponse, BlockReason, ClientSignals };
export type { TestAttemptIdentity } from '@/shared/types/test-attempt';

/**
 * 클라이언트 신호. lib/duplicate-detection/types.ts 의 ClientSignals 형태를 그대로 모델링.
 * deviceId 는 nullable (LocalStorage 차단/시크릿 모드 시 null), 나머지는 문자열.
 * z.infer 가 ClientSignals 와 호환되도록 필드를 명시한다.
 */
export const ClientSignalsSchema = z.object({
  deviceId: z.string().nullable(),
  screen: z.string(),
  tz: z.string(),
  lang: z.string(),
  platform: z.string(),
});

/**
 * 질문 응답값 맵(JSONB). 응답값은 text/array/object 등 다형이라 unknown 으로 유지.
 * 원본 시그니처(Record<string, unknown>) 그대로 보존 — 과도한 스키마화는 회귀 위험.
 */
export const QuestionResponsesSchema = z.record(z.string(), z.unknown());

/**
 * 응답 행 output. surveyResponses.$inferSelect 전체를 z.custom 으로 타입만 보장(런타임 통과).
 * .returning() 전체 행을 그대로 통과시키는 원본 동작 보존.
 */
export const SurveyResponseRowSchema = z.custom<SurveyResponse>();

export const TestAttemptIdentityFields = {
  attemptId: z.string().uuid().optional(),
  sessionId: z.string().optional(),
} as const;

// zod 전송 필드와 shared 정적 계약의 드리프트를 컴파일 단계에서 막는다.
type _TestAttemptIdentityContract = z.infer<z.ZodObject<typeof TestAttemptIdentityFields>>;
const _testAttemptIdentityContract: TestAttemptIdentity = {} as _TestAttemptIdentityContract;
void _testAttemptIdentityContract;

// ─────────────────────────────────────────────────────────────────────────────
// startResponse
// ─────────────────────────────────────────────────────────────────────────────

export const StartResponseInput = z.object({
  surveyId: z.string(),
  sessionId: z.string().optional(),
  versionId: z.string().optional(),
});
export type StartResponseInput = z.infer<typeof StartResponseInput>;

// ─────────────────────────────────────────────────────────────────────────────
// updateQuestionResponse
// ─────────────────────────────────────────────────────────────────────────────

export const UpdateQuestionResponseInput = z.object({
  responseId: z.string(),
  questionId: z.string(),
  value: z.unknown(),
  ...TestAttemptIdentityFields,
});
export type UpdateQuestionResponseInput = z.infer<typeof UpdateQuestionResponseInput>;

// ─────────────────────────────────────────────────────────────────────────────
// saveDraftResponse
// ─────────────────────────────────────────────────────────────────────────────

export const SaveDraftResponseInput = z.object({
  // 상한 128: REST beacon 경로에서 이 값이 그대로 rate limit Redis 키가 되므로
  // 임의 길이 문자열을 막는다 (실값은 UUID 36자). oRPC 경로의 클라이언트 축 추출기
  // (extractRateLimitClientId)와 같은 상한.
  responseId: z.string().max(128),
  answers: QuestionResponsesSchema,
  /** 클라이언트 발급 단조 증가 순번. 지연 도착한 오래된 draft 쓰기를 서버가 무시하는 데 쓴다. */
  seq: z.number().int().positive().optional(),
  ...TestAttemptIdentityFields,
});
export type SaveDraftResponseInput = z.infer<typeof SaveDraftResponseInput>;

export const SaveDraftResponseOutput = z.object({
  ok: z.literal(true),
  /**
   * 실제로 답변이 쓰였는지 여부. seq 가드가 stale 로 판정하면 false — 호출측(flushPendingAnswers)
   * 은 이 값이 false 면 pending 을 비우지 않아야 한다(그렇지 않으면 서버에 반영되지 않은 값을
   * "저장됨" 으로 착각해 유실한다).
   */
  applied: z.boolean(),
});

// ─────────────────────────────────────────────────────────────────────────────
// createResponseWithFirstAnswer / createBlankResponse
// ─────────────────────────────────────────────────────────────────────────────

export const CreateResponseWithFirstAnswerInput = z.object({
  surveyId: z.string(),
  sessionId: z.string(),
  versionId: z.string().nullable(),
  questionId: z.string(),
  value: z.unknown(),
  currentStepId: z.string(),
  // 운영 콘솔 진척 표기용 visible step 진척 (클라 계산값). 미전송/구 클라 호환 위해 nullish.
  visibleStepIndex: z.number().int().nullish(),
  visibleStepTotal: z.number().int().nullish(),
  inviteToken: z.string().optional(),
  // null 이면 신호 기반 검사 skip — LocalStorage 차단 등 클라이언트 신호 수집 실패 시 null 그대로
  clientSignals: ClientSignalsSchema.nullable(),
  // 봇 방어 허니팟. 실제 클라이언트는 hidden 필드라 항상 빈 값. 봇이 채우면 차단.
  honeypot: z.string().optional(),
  // 테스트 링크 토큰 — surveys.testModeEnabled + testToken 과 일치하면 isTest 세션으로 기록.
  testToken: z.string().optional(),
  attemptId: TestAttemptIdentityFields.attemptId,
});
export type CreateResponseWithFirstAnswerInput = z.infer<typeof CreateResponseWithFirstAnswerInput>;

export const CreateBlankResponseInput = z.object({
  surveyId: z.string(),
  sessionId: z.string(),
  versionId: z.string().nullable(),
  currentStepId: z.string(),
  inviteToken: z.string().optional(),
  clientSignals: ClientSignalsSchema.nullable(),
  // 봇 방어 허니팟. 실제 클라이언트는 hidden 필드라 항상 빈 값. 봇이 채우면 차단.
  honeypot: z.string().optional(),
  // 테스트 링크 토큰 — surveys.testModeEnabled + testToken 과 일치하면 isTest 세션으로 기록.
  testToken: z.string().optional(),
  attemptId: TestAttemptIdentityFields.attemptId,
});
export type CreateBlankResponseInput = z.infer<typeof CreateBlankResponseInput>;

/**
 * createResponseWithFirstAnswer / createBlankResponse 의 반환.
 * - created: 응답 행 생성/재사용 성공 (id + contactTargetId)
 * - blocked: 중복 감지로 차단 (BlockReason)
 * BlockReason 은 lib/duplicate-detection/types.ts 의 union 을 z.enum 으로 그대로 모델링.
 */
export const BlockReasonSchema = z.enum([
  'invalid_token',
  'token_already_used',
  'device_already_responded',
  'excluded_from_population',
  'quota_closed',
  'survey_paused',
  'invalid_test_token',
  'not_accepting',
]);

export const FirstAnswerResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('created'),
    id: z.string(),
    contactTargetId: z.string().nullable(),
    /**
     * 응답 행에 이미 적용된 draft seq(survey_responses.metadata.draftSeq) — 컨택 재사용으로
     * 기존 행을 물려받을 때만 값이 있다. 클라이언트가 draftSeqRef 를 이 값 이상으로 seed 해,
     * localStorage 없는 재진입(다른 기기·시크릿창)에서도 이후 flush 가 stale 로 막히지 않게 한다.
     */
    draftSeq: z.number().int().nonnegative().optional(),
    /**
     * 실제 행에 기록된 versionId (무중단 갈아타기 — 티켓 04).
     * 배포 전 열린 탭이 구버전 versionId 로 첫 답변을 보내면 서버가 현재 버전으로 재핀해
     * 행을 만든다. 클라이언트는 이 값이 자신이 알던 versionId 와 다르면 재핀을 감지해
     * 최신 스냅샷을 재취득한다. optional 인 이유는 구 클라이언트/스키마 호환.
     */
    versionId: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal('blocked'),
    reason: BlockReasonSchema,
  }),
]);
export type FirstAnswerResult = z.infer<typeof FirstAnswerResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// completeResponse
// ─────────────────────────────────────────────────────────────────────────────

export const CompleteResponseInput = z.object({
  responseId: z.string(),
  data: z
    .object({
      questionResponses: QuestionResponsesSchema.optional(),
      exposedQuestionIds: z.array(z.string()).optional(),
      exposedRowIds: z.array(z.string()).optional(),
    })
    .optional(),
  ...TestAttemptIdentityFields,
});
export type CompleteResponseInput = z.infer<typeof CompleteResponseInput>;
