import * as z from 'zod';

import {
  isConcludedResponseStatus,
  responseStatusValues,
} from '@/shared/contracts/survey-response';

import type { BlockReason } from './duplicate';
import { QuestionResponsesSchema, TestAttemptIdentityFields } from './response';

// ─────────────────────────────────────────────────────────────────────────────
// recordStepVisit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 페이지 이동(스텝 전환) 기록 input.
 * 원본 시그니처(responseId/nextStepId) 그대로 보존.
 */
export const RecordStepVisitInput = z.object({
  responseId: z.string(),
  nextStepId: z.string(),
  // 운영 콘솔 진척 표기용 visible step 진척 (클라 계산값). 미전송/구 클라 호환 위해 nullish.
  visibleStepIndex: z.number().int().nullish(),
  visibleStepTotal: z.number().int().nullish(),
  ...TestAttemptIdentityFields,
});
export type RecordStepVisitInput = z.infer<typeof RecordStepVisitInput>;

/**
 * 스텝 전환 기록 output.
 *
 * 중단(survey_paused) 판정을 이 응답에 편승시킨다 — 스텝 전환은 이미 매번 이 RPC 를
 * 발사하므로 새 왕복·새 procedure·새 rate limit 버킷이 필요 없다. 판정 자체는
 * domain/acceptance 의 ongoingResponseDenial 소관이라 denial 은 그 반환 union 과 동치다.
 *
 * 구 서버(필드 없음)를 만난 신 클라이언트는 denial 이 undefined 가 되어 아무 것도 하지
 * 않는다 — 배포 스큐에서 fail-open.
 */
export const RecordStepVisitOutput = z.object({
  ok: z.literal(true),
  denial: z.literal('survey_paused').nullable(),
  /** 중단일 때만 채워지는 운영자 최신 문구. 화면 폴백 체인의 최우선 값. */
  pausedMessage: z.string().nullable(),
});
export type RecordStepVisitOutput = z.infer<typeof RecordStepVisitOutput>;

// ─────────────────────────────────────────────────────────────────────────────
// recordVisibilitySegment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Page Visibility 세그먼트 기록 input (sendBeacon 대상).
 * action 은 'hide' | 'show' 두 값만 허용.
 */
export const RecordVisibilitySegmentInput = z.object({
  // 상한 128: REST beacon 경로에서 rate limit Redis 키로 쓰이므로 임의 길이를 막는다
  // (실값은 UUID 36자, SaveDraftResponseInput 과 동일 관례).
  responseId: z.string().max(128),
  action: z.enum(['hide', 'show']),
  ...TestAttemptIdentityFields,
});
export type RecordVisibilitySegmentInput = z.infer<typeof RecordVisibilitySegmentInput>;

// ─────────────────────────────────────────────────────────────────────────────
// resumeOrCreateResponse
// ─────────────────────────────────────────────────────────────────────────────

export const ResumeOrCreateResponseInput = z.object({
  surveyId: z.string(),
  sessionId: z.string(),
  inviteToken: z.string().optional(),
  // 테스트 링크 토큰 — surveys.testModeEnabled + testToken 과 일치하면 재개 게이트에서
  // isTest 세션으로 취급해 중단(paused) 예외를 허용한다.
  testToken: z.string().optional(),
});
export type ResumeOrCreateResponseInput = z.infer<typeof ResumeOrCreateResponseInput>;

/**
 * resumeOrCreateResponse 반환 status. survey_responses.status 의 6개 값 그대로 모델링.
 * 어휘는 @/shared/contracts/survey-response 의 responseStatusValues 가 SSOT 다 —
 * 원본 시그니처의 union ('in_progress' | 'completed' | 'screened_out' | 'quotaful_out'
 * | 'bad' | 'drop') 과 동일한 z.enum 이 파생된다.
 */
export const ResumeStatusSchema = z.enum(responseStatusValues);

/**
 * 이미 존재하는 응답 행을 재사용하려 할 때, 그 행의 status 로 다음 동작을 결정한다.
 *
 * 배경: sweep_stale_sessions() pg_cron 은 3시간 유휴 in_progress 를 drop 으로 바꾸면서
 * is_completed 는 false 로 남긴다. 컨택 재사용 조회(findActiveResponseByContact)가
 * is_completed=false 만 보고 drop 행을 집어오면, 쓰기(applyQuestionResponseUpdate)는
 * status='in_progress' 를 요구하므로 0행이 되어 500 이 난다. 읽기와 쓰기가 같은 기준을
 * 쓰도록 판정을 이 한 곳에 모은다.
 *
 * - in_progress: 그대로 재사용
 * - drop: resumeOrCreateResponse 와 동일하게 in_progress 로 되살린 뒤 재사용
 * - 종결 상태 및 알 수 없는 값: 새 답변을 받지 않고 차단 (500 대신 안내 화면)
 *
 * 단, 유효 테스트 세션(isTestSession)은 종결 상태에서 차단 대신 restart 로 판정한다 —
 * 운영자가 테스트 링크로 완료한 뒤 같은 링크로 다시 들어오면 처음부터 다시 응답해야 한다.
 * 이 완화는 호출부가 테스트 세션임을 증명했을 때만 적용되며, 알 수 없는 status 는
 * 테스트 세션이어도 계속 차단한다.
 */
export type ResponseReuseDecision =
  | { action: 'reuse' }
  | { action: 'revive' }
  | { action: 'restart' }
  | { action: 'blocked'; reason: BlockReason };

export function decideResponseReuse(
  status: string,
  opts: { hasContact: boolean; isTestSession?: boolean },
): ResponseReuseDecision {
  if (status === 'in_progress') return { action: 'reuse' };
  if (status === 'drop') return { action: 'revive' };
  // 테스트 세션 한정 완화. 옵션 미지정(기존 호출처)은 false 라 실응답 판정은 무변경.
  // "처음부터 다시" 로 되돌릴 수 있는 것은 종결 상태 화이트리스트(contracts 의
  // concludedResponseStatusValues)뿐 — 알 수 없는 값은 술어가 false 라 아래 차단으로 흐른다.
  if (opts.isTestSession === true && isConcludedResponseStatus(status)) {
    return { action: 'restart' };
  }
  if (status === 'quotaful_out') return { action: 'blocked', reason: 'quota_closed' };
  // completed/screened_out/bad, 그리고 알 수 없는 값. 알 수 없는 값을 재사용으로 흘리면
  // 쓰기 가드에서 다시 500 이 되므로 보수적으로 차단한다(테스트 세션도 동일).
  return {
    action: 'blocked',
    reason: opts.hasContact ? 'token_already_used' : 'device_already_responded',
  };
}

/**
 * resumeOrCreateResponse 반환.
 * - 기존 응답이 있으면 { id, status, resumed }
 * - 첫 진입(매칭 행 없음) 또는 알 수 없는 status 면 null
 * 원본의 `... | null` 시그니처를 .nullable() 로 보존.
 */
export const ResumeOrCreateResponseOutput = z
  .object({
    id: z.string(),
    status: ResumeStatusSchema,
    resumed: z.boolean(),
    questionResponses: QuestionResponsesSchema.optional(),
    /** 마지막으로 머문 스텝 id — 재접속 시 멈춘 페이지 복원용 (in_progress 회복 경로에서만 설정). */
    currentStepId: z.string().nullable().optional(),
    /**
     * 응답 행에 마지막으로 적용된 draft seq(survey_responses.metadata.draftSeq).
     * 클라이언트가 draftSeqRef 를 이 값으로 seed 해 2차 세션이 0 부터 다시 발급한 낮은 seq 로
     * claimDraftSeq 를 stale 처리시켜 저장이 조용히 유실되는 것을 막는다(in_progress 전용).
     */
    draftSeq: z.number().int().nonnegative().optional(),
    /**
     * 재응답 허용(metadata.reeditPendingSince) 세션 표식 — 클라이언트가 상단에
     * "끝까지 제출해야 완료로 반영" 배너를 띄운다.
     */
    reeditPending: z.boolean().optional(),
    /**
     * 응답 버전 이관(ADR-0014)에서 답이 폐기·부분 제거된 질문 ID 목록.
     * 클라이언트는 이 중 신버전에 실존하는 가장 앞 페이지로 재개 위치를 되돌린다.
     * 이관이 없었거나 영향 질문이 없으면 생략.
     */
    affectedQuestionIds: z.array(z.string()).optional(),
  })
  .nullable();
export type ResumeOrCreateResponseOutput = z.infer<typeof ResumeOrCreateResponseOutput>;
