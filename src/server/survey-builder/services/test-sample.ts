import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema';
import { getFirstContactSample } from '@/server/read-models/contact-sample';
import { loadOperationsDataScope } from '@/server/data-scope';
import { loadSurveyCapabilities, type SurveyAccessUser } from '@/server/survey-access';

import type { SurveyTestSample } from '../domain/test-sample';

/**
 * 빌더의 "테스트 중" 상태에서 본문의 {{변수}} 토큰을 첫 컨택의 attrs 로 치환하기 위한 샘플.
 * 응답 페이지 본체는 invite_token 없는 익명 접근을 받기 때문에 자동 fallback 하면 PII 노출 위험이 있어,
 * 어드민 인증된 빌더 안에서만 첫 컨택 attrs 를 제공한다.
 * 컨택이 0건이면 null.
 *
 * email/inviteToken 등 PII 는 노출하지 않고 attrs/resid 만 추출한다(기존 동작 보존).
 *
 * **실컨택 값은 `contacts.view` 를 가진 사람에게만 준다.** attrs 는 업로드한 엑셀 행에서 PII
 * 지정 컬럼을 뺀 나머지지만(그건 contact_pii 로 간다), 무엇을 PII 로 지정할지는 운영자가
 * 정하므로 남는 값이 개인정보가 아니라는 보장이 없고 resid 는 그 자체로 식별자다. 팀 공개
 * 설문의 일반 팀원은 survey.view 는 있어도 contacts.view 가 없다 — 컨택 열람을 막아둔
 * 매트릭스를 이 경로가 우회했다(Codex 적대적 리뷰).
 *
 * 권한이 없으면 null 이다. 합성 샘플을 만들지 않는 이유는 "컨택 0건" 이 이미 null 이고 화면이
 * 그 상태를 아는 상태이기 때문 — 토큰이 치환되지 않고 `{{변수}}` 그대로 보인다.
 */
export async function getSurveyTestSample(
  user: SurveyAccessUser,
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

  const capabilities = await loadSurveyCapabilities(user, surveyId);
  if (!capabilities.has('contacts.view')) return null;

  const scope = await loadOperationsDataScope(surveyId);
  const sample = await getFirstContactSample(surveyId, scope);
  if (!sample) return null;
  return { attrs: sample.attrs, resid: sample.resid };
}
