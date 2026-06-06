import { authed } from '@/server/orpc';

import {
  SaveResultSchema,
  SaveSurveyWithDetailsInput,
  SurveyDiffPayloadSchema,
} from '../../domain/survey-save';
import * as svc from '../services/survey-save.service';

/**
 * 설문 저장 procedure (authed).
 * - saveDiff: 변경분(diff)만 전송하는 빌더 저장.
 * - saveWithDetails: 전체 설문(설문+그룹+질문) 일괄 저장(신규 생성 전용).
 */

const saveDiff = authed
  .input(SurveyDiffPayloadSchema)
  .output(SaveResultSchema)
  .handler(({ input }) => svc.saveSurveyDiff(input));

const saveWithDetails = authed
  .input(SaveSurveyWithDetailsInput)
  .output(SaveResultSchema)
  .handler(({ input }) => svc.saveSurveyWithDetails(input));

export const save = {
  saveDiff,
  saveWithDetails,
};
