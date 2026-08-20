import { pub, withRateLimit } from '@/server/orpc';

import {
  SurveyBySlugInput,
  SurveyByPrivateTokenInput,
  SurveyForResponseInput,
  SurveyForResponseOutput,
  SurveyIdRowOutput,
} from '../../domain/survey-read';
import * as surveySvc from '../services/survey-read.service';

// 응답자 공개 경로(survey-response-flow). 원본 3함수 모두 requireAuth 없음 → pub 유지.
//
// 무인증 표면이므로 rate limit 을 부착한다. 전용 public-read 버킷을 쓰는 이유는
// 버킷 분리 원칙(rate-limiter.ts 프리셋 주석)이다 — 같은 진입 시점의 lifecycle.resume /
// duplicate.checkOnEntry / contacts.attrs.lookup 이 쓰는 lookup 버킷(IP 당 60회/1분)에
// 이 3종까지 합치면 응답자 1명당 lookup 소비가 3회에서 5회로 늘어, 같은 NAT(사무실·
// 전시장·CGNAT) 뒤에서 동시에 진입할 수 있는 인원이 그만큼 줄어든다. 리미터가 응답자를
// 막았던 2026-08-10 사고와 같은 형태라 기존 버킷을 잠식하지 않도록 분리한다.
//
// 세 input(slug / token / surveyId)에는 sessionId·responseId 가 없어 클라이언트 축이
// 잡히지 않는다 — extractRateLimitClientId 가 null 을 반환하고 public-read 는
// IP_WIDE_GROUPS 미등재라 키는 `public-read:ip` 단일 IP 버킷이 된다. 그래서 한도도
// 세션 단위 fine 버킷이 아니라 다른 `-ip` 전체 가드와 같은 스케일로 잡았다.
const publicReadRateLimited = pub.use(withRateLimit('public-read'));

/** 슬러그로 설문 조회(pub). 익명 응답자 진입 경로. 유출 방지로 id 만 반환(I-3). */
const bySlug = publicReadRateLimited
  .input(SurveyBySlugInput)
  .output(SurveyIdRowOutput)
  .handler(({ input }) => surveySvc.getSurveyBySlug(input));

/** 비공개 토큰으로 설문 조회(pub). 유출 방지로 id 만 반환(I-3). */
const byPrivateToken = publicReadRateLimited
  .input(SurveyByPrivateTokenInput)
  .output(SurveyIdRowOutput)
  .handler(({ input }) => surveySvc.getSurveyByPrivateToken(input));

/** 응답 페이지용 설문 조회(pub). 배포 스냅샷 우선 + 미배포 fallback
 * + 중단 상태/테스트 링크 판정(control). */
const forResponse = publicReadRateLimited
  .input(SurveyForResponseInput)
  .output(SurveyForResponseOutput)
  .handler(({ input }) => surveySvc.getSurveyForResponse(input));

export const publicRead = {
  bySlug,
  byPrivateToken,
  forResponse,
};
