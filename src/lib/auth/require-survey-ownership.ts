import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema';

import { requireAuth } from '@/lib/auth';

export class SurveyOwnershipError extends Error {
  constructor(public readonly reason: 'not_found') {
    super(reason);
    this.name = 'SurveyOwnershipError';
  }
}

/**
 * 어드민 server action 진입 가드.
 * - 로그인 안 됨 -> requireAuth 가 에러 throw (기존 동작)
 * - surveyId 없음 -> SurveyOwnershipError('not_found')
 *
 * 현재 시스템은 단일 어드민 구조이므로 surveys 테이블에 userId 컬럼이 없다.
 * 인증된 사용자라면 모든 설문에 접근 가능하다. 다중 사용자 전환 시
 * surveys.userId 컬럼을 추가하고 reason에 'forbidden' 값을 추가한다.
 *
 * 호출 후 surveys 행을 그대로 반환해 후속 SELECT 1회를 절약한다.
 */
export async function requireSurveyOwnership(surveyId: string) {
  const user = await requireAuth();
  const row = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { id: true },
  });
  if (!row) throw new SurveyOwnershipError('not_found');
  return { user, survey: row };
}
