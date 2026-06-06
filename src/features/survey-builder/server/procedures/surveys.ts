import { authed } from '@/server/orpc';

import {
  CreateSurveyInput,
  DeleteSurveyOutput,
  DuplicateResultSchema,
  EnsureSurveyInDbInput,
  EnsureSurveyResultSchema,
  SurveyIdInput,
  SurveyRowSchema,
  UpdateSurveyInput,
} from '../../domain/survey';
import * as svc from '../services/surveys.service';

/**
 * 설문 CRUD procedure (authed). 모든 빌더 경로는 관리자 인증 필수.
 * 각 procedure 는 도메인 zod input/output + service 위임 1줄.
 */

const ensure = authed
  .input(EnsureSurveyInDbInput)
  .output(EnsureSurveyResultSchema)
  .handler(({ input }) => svc.ensureSurveyInDb(input));

const create = authed
  .input(CreateSurveyInput)
  .output(SurveyRowSchema)
  .handler(({ input }) => svc.createSurvey(input));

const update = authed
  .input(UpdateSurveyInput)
  .output(SurveyRowSchema)
  .handler(({ input }) => svc.updateSurvey(input));

// delete 는 예약어이므로 export 키는 del 로 둔다(router 접근 경로는 surveys.delete).
const del = authed
  .input(SurveyIdInput)
  .output(DeleteSurveyOutput)
  .handler(({ input }) => svc.deleteSurvey(input));

const duplicate = authed
  .input(SurveyIdInput)
  .output(DuplicateResultSchema)
  .handler(({ input }) => svc.duplicateSurvey(input));

export const surveys = {
  ensure,
  create,
  update,
  delete: del,
  duplicate,
};
