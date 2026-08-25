import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema';
import { getFirstContactSample } from '@/server/read-models/contact-sample';
import { loadOperationsDataScope } from '@/server/data-scope.server';

import type { SurveyTestSample } from '../domain/test-sample';

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
  // create 페이지의 미저장(로컬 전용) 설문에서도 빌더 미리보기가 백그라운드로 호출한다 —
  // 설문 미존재는 에러가 아니라 "컨택 0건"과 동일 의미론이다. loadOperationsDataScope 의
  // throw 를 그대로 흘리면 질문 추가 때마다 500 이 dev 오버레이/로그를 오염시킨다.
  const [existing] = await db
    .select({ id: surveys.id })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  if (!existing) return null;

  const scope = await loadOperationsDataScope(surveyId);
  const sample = await getFirstContactSample(surveyId, scope);
  if (!sample) return null;
  return { attrs: sample.attrs, resid: sample.resid };
}
