import 'server-only';

import { count, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema';

/**
 * 설문의 컨택 설정 통계 — 조건부 열 판정의 단일 출처.
 *
 * "설문 설정 기준"(컨택 타겟 존재 여부, 응답 매칭 무관)으로
 * 엑셀 내보내기(번호(systemID)·조사 대상 그룹 열)와 운영 콘솔 응답 목록(번호(ID) 열)이
 * 같은 규칙을 공유한다 — CONTEXT.md 「응답 메타 컬럼」 참조.
 */
export async function getSurveyContactStats(
  surveyId: string,
): Promise<{ hasContacts: boolean; hasContactGroups: boolean }> {
  const rows = await db
    .select({ total: count(), withGroup: count(contactTargets.groupValue) })
    .from(contactTargets)
    .where(eq(contactTargets.surveyId, surveyId));
  return {
    hasContacts: (rows[0]?.total ?? 0) > 0,
    hasContactGroups: (rows[0]?.withGroup ?? 0) > 0,
  };
}
