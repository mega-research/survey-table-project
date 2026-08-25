import 'server-only';

import { and, count, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema';

import { targetScopeCondition, type OperationsDataScope } from '@/server/data-scope.server';

/**
 * 설문의 컨택 설정 통계 — 조건부 열 판정의 단일 출처.
 *
 * "설문 설정 기준"(컨택 타겟 존재 여부, 응답 매칭 무관)으로
 * 엑셀 내보내기(시스템ID·조사 대상 그룹 열)와 운영 콘솔 응답 목록(시스템ID 열)이
 * 같은 규칙을 공유한다 — CONTEXT.md 「응답 메타 컬럼」 참조.
 *
 * scope 필수 — 컨택 타겟도 real/test 이원화(contact_targets.is_test)돼 있어,
 * 반대 스코프에만 컨택이 있는 설문에서 빈 열이 생기지 않도록 스코프로 한정해 센다.
 * (raw export 는 테스트 응답을 제외하므로 'real', 운영 콘솔은 현재 화면 스코프)
 */
export async function getSurveyContactStats(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<{ hasContacts: boolean; hasContactGroups: boolean }> {
  const rows = await db
    .select({ total: count(), withGroup: count(contactTargets.groupValue) })
    .from(contactTargets)
    .where(and(eq(contactTargets.surveyId, surveyId), targetScopeCondition(scope)));
  return {
    hasContacts: (rows[0]?.total ?? 0) > 0,
    hasContactGroups: (rows[0]?.withGroup ?? 0) > 0,
  };
}
