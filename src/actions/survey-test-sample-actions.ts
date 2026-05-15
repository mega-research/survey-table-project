'use server';

import { requireAuth } from '@/lib/auth';
import { getFirstContactSample } from '@/lib/operations/contact-sample.server';

export interface SurveyTestSample {
  attrs: Record<string, string>;
  resid: number;
}

interface ActionResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

/**
 * 빌더의 "테스트 중" 상태에서 본문의 {{변수}} 토큰을 첫 컨택의 attrs 로 치환하기 위한 샘플.
 * 응답 페이지 본체는 invite_token 없는 익명 접근을 받기 때문에 자동 fallback 하면 PII 노출 위험이 있어,
 * 어드민 인증된 빌더 안에서만 첫 컨택 attrs 를 제공한다.
 * 컨택이 0건이면 data: null.
 */
export async function getSurveyTestSampleAction(
  surveyId: string,
): Promise<ActionResult<SurveyTestSample | null>> {
  await requireAuth();
  const sample = await getFirstContactSample(surveyId);
  if (!sample) return { ok: true, data: null };
  return {
    ok: true,
    data: { attrs: sample.attrs, resid: sample.resid },
  };
}
