import { pub } from '@/server/orpc';

import {
  SurveyBySlugInput,
  SurveyByPrivateTokenInput,
  SurveyForResponseOutput,
  SurveyIdInput,
  SurveyRowOutput,
} from '../../domain/survey-read';
import * as surveySvc from '../services/survey-read.service';

// 응답자 공개 경로(survey-response-flow). 원본 3함수 모두 requireAuth 없음 → pub 유지.

/** 슬러그로 설문 조회(pub). 익명 응답자 진입 경로. */
const bySlug = pub
  .input(SurveyBySlugInput)
  .output(SurveyRowOutput)
  .handler(({ input }) => surveySvc.getSurveyBySlug(input));

/** 비공개 토큰으로 설문 조회(pub). */
const byPrivateToken = pub
  .input(SurveyByPrivateTokenInput)
  .output(SurveyRowOutput)
  .handler(({ input }) => surveySvc.getSurveyByPrivateToken(input));

/** 응답 페이지용 설문 조회(pub). 배포 스냅샷 우선 + 미배포 fallback. */
const forResponse = pub
  .input(SurveyIdInput)
  .output(SurveyForResponseOutput)
  .handler(({ input }) => surveySvc.getSurveyForResponse(input));

export const publicRead = {
  bySlug,
  byPrivateToken,
  forResponse,
};
