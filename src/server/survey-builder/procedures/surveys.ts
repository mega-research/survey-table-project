import { authed } from '@/server/orpc';
import {
  assertSurveyCapabilityRpc,
  toRpcSurveyAccessError,
} from '@/server/rpc-survey-access';

import {
  CreateSurveyInput,
  DeleteSurveyOutput,
  DuplicateResultSchema,
  EnsureSurveyInDbInput,
  EnsureSurveyResultSchema,
  SurveyIdInput,
  SurveyRowSchema,
  UpdateSurveyInput,
} from '../domain/survey';
import * as svc from '../services/surveys';

/**
 * 설문 CRUD procedure (authed).
 * 생성 경로(ensure/create/duplicate)는 서비스가 소유·배치를 판정하고(티켓 07),
 * 기존 설문을 지목하는 update/delete 는 handler 첫 줄에서 capability 관문을 지난다(티켓 09).
 */

const ensure = authed
  .input(EnsureSurveyInDbInput)
  .output(EnsureSurveyResultSchema)
  .handler(({ context, input }) => svc.ensureSurveyInDb(context.user, input));

const create = authed
  .input(CreateSurveyInput)
  .output(SurveyRowSchema)
  .handler(({ context, input }) => svc.createSurvey(context.user, input));

const update = authed
  .input(UpdateSurveyInput)
  .output(SurveyRowSchema)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.updateSurvey(input);
  });

// delete 는 예약어이므로 export 키는 del 로 둔다(router 접근 경로는 surveys.delete).
const del = authed
  .input(SurveyIdInput)
  .output(DeleteSurveyOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.delete');
    return svc.deleteSurvey(input);
  });

// 복제는 원본 읽기 권한 검사가 서비스 안(원본 조회 직전)에 있다 — 사유만 RPC 어휘로 옮긴다.
const duplicate = authed
  .input(SurveyIdInput)
  .output(DuplicateResultSchema)
  .handler(async ({ context, input }) => {
    try {
      return await svc.duplicateSurvey(context.user, input);
    } catch (error) {
      throw toRpcSurveyAccessError(error);
    }
  });

export const surveys = {
  ensure,
  create,
  update,
  delete: del,
  duplicate,
};
