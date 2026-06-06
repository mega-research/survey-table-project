import 'server-only';

import { getFirstContactSample } from '@/lib/operations/contact-sample.server';

import type { SurveyTestSample } from '../../domain/test-sample';

/**
 * 빌더의 "테스트 중" 상태에서 본문의 {{변수}} 토큰을 첫 컨택의 attrs 로 치환하기 위한 샘플.
 * 응답 페이지 본체는 invite_token 없는 익명 접근을 받기 때문에 자동 fallback 하면 PII 노출 위험이 있어,
 * 어드민 인증된 빌더 안에서만 첫 컨택 attrs 를 제공한다.
 * 컨택이 0건이면 null.
 *
 * email/inviteToken 등 PII 는 노출하지 않고 attrs/resid 만 추출한다(기존 동작 보존).
 */
export async function getSurveyTestSample(
  surveyId: string,
): Promise<SurveyTestSample | null> {
  const sample = await getFirstContactSample(surveyId);
  if (!sample) return null;
  return { attrs: sample.attrs, resid: sample.resid };
}
