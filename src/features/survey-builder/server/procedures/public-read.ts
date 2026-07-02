import { pub } from '@/server/orpc';

import {
  SurveyBySlugInput,
  SurveyByPrivateTokenInput,
  SurveyForResponseInput,
  SurveyForResponseOutput,
  SurveyIdRowOutput,
} from '../../domain/survey-read';
import * as surveySvc from '../services/survey-read.service';

// 응답자 공개 경로(survey-response-flow). 원본 3함수 모두 requireAuth 없음 → pub 유지.

/** 슬러그로 설문 조회(pub). 익명 응답자 진입 경로. 유출 방지로 id 만 반환(I-3). */
const bySlug = pub
  .input(SurveyBySlugInput)
  .output(SurveyIdRowOutput)
  .handler(({ input }) => surveySvc.getSurveyBySlug(input));

/** 비공개 토큰으로 설문 조회(pub). 유출 방지로 id 만 반환(I-3). */
const byPrivateToken = pub
  .input(SurveyByPrivateTokenInput)
  .output(SurveyIdRowOutput)
  .handler(({ input }) => surveySvc.getSurveyByPrivateToken(input));

/** 응답 페이지용 설문 조회(pub). 배포 스냅샷 우선 + 미배포 fallback
 * + 중단 상태/테스트 링크 판정(control). */
const forResponse = pub
  .input(SurveyForResponseInput)
  .output(SurveyForResponseOutput)
  .handler(({ input }) => surveySvc.getSurveyForResponse(input));

export const publicRead = {
  bySlug,
  byPrivateToken,
  forResponse,
};
