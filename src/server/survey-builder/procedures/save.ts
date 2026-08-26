import { authed } from '@/server/orpc';
import {
  assertSurveyCapabilityRpc,
  toRpcSurveyAccessError,
} from '@/server/rpc-survey-access';

import {
  SaveResultSchema,
  SaveSurveyWithDetailsInput,
  SurveyDiffPayloadSchema,
} from '../domain/survey-save';
import * as svc from '../services/survey-save';

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
    return svc.saveSurveyDiff(input);
  });

const saveWithDetails = authed
  .input(SaveSurveyWithDetailsInput)
  .output(SaveResultSchema)
  .handler(async ({ context, input }) => {
    try {
      return await svc.saveSurveyWithDetails(context.user, input);
    } catch (error) {
      throw toRpcSurveyAccessError(error);
    }
  });

export const save = {
  saveDiff,
  saveWithDetails,
};
