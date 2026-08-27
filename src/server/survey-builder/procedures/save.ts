import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';
import {
  assertSurveyCapabilityRpc,
  toRpcSurveyAccessError,
} from '@/server/rpc-survey-access';

import { SurveyOwnershipRequiredError } from '../domain/survey';
import {
  CrossSurveyRowError,
  SaveResultSchema,
  SaveSurveyWithDetailsInput,
  SurveyDiffPayloadSchema,
} from '../domain/survey-save';
import * as svc from '../services/survey-save';

/**
 * 저장 payload 가 타 설문 하위 행을 지목하면 FORBIDDEN 이다.
 *
 * saveWithDetails 의 생성 모드는 resolveNewSurveyOwnership 을 지나므로 소유 팀을 정할 수
 * 없는 거부(시스템 전체 보기·팀 미배치·해산된 팀)도 여기로 온다 — 매핑이 없으면 500 이 된다.
 *
 * 정상 저장에서는 절대 나오지 않는 에러다 — 새 id 는 삽입, 내 설문 id 는 갱신이라 이 분기에
 * 닿으려면 남의 설문 질문 id 를 알아야 한다. 조용히 무시하면 화면은 저장됐다고 말하는데
 * 실제로는 일부가 빠진 상태가 되므로 거절하고 알린다.
 */
function rethrowSaveError(error: unknown): never {
  if (error instanceof CrossSurveyRowError) {
    throw new ORPCError('FORBIDDEN', { message: error.message });
  }
  if (error instanceof SurveyOwnershipRequiredError) {
    throw new ORPCError('CONFLICT', { message: error.message });
  }
  throw toRpcSurveyAccessError(error);
}

/**
 * 설문 저장 procedure (authed).
 * - saveDiff: 변경분(diff)만 전송하는 빌더 저장 — 기존 설문 전용이라 관문을 여기서 지난다.
 * - saveWithDetails: 전체 설문 일괄 저장. 신규 생성과 기존 갱신이 한 입구라 관문(모드
 *   분기)은 서비스가 트랜잭션 안에서 정한다 — procedure 에서 "없으면 생성 모드" 로
 *   가르면 그 판정과 쓰기 사이가 벌어져 tombstone 부활·생성 레이스가 된다(티켓 09).
 */

const saveDiff = authed
  .input(SurveyDiffPayloadSchema)
  .output(SaveResultSchema)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.saveSurveyDiff(input).catch(rethrowSaveError);
  });

const saveWithDetails = authed
  .input(SaveSurveyWithDetailsInput)
  .output(SaveResultSchema)
  .handler(async ({ context, input }) => {
    try {
      return await svc.saveSurveyWithDetails(context.user, input);
    } catch (error) {
      rethrowSaveError(error);
    }
  });

export const save = {
  saveDiff,
  saveWithDetails,
};
