import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveys } from '@/db/schema';
import { testFlagForScope, type OperationsDataScope } from '@/lib/operations/data-scope.server';

import type { UpdateContactColumnsInput } from '../../domain/contact-column';

/**
 * 컨택리스트 표시 컬럼 스킴(surveys.contactColumns) 갱신.
 * resid 컬럼은 hide 불가 가드(spec 엣지케이스 #28).
 * 인증은 authed 미들웨어, 캐시 갱신은 소비처 router.refresh/push 로 대체.
 */
export async function updateContactColumns(input: UpdateContactColumnsInput): Promise<void> {
  const { surveyId, scheme } = input;
  // resid 는 hide 불가 가드
  for (const c of scheme.columns) {
    if (c.source === 'system.resid' && c.hidden) {
      throw new Error('resid 컬럼은 숨길 수 없습니다.');
    }
  }
  await db.transaction(async (tx) => {
    const [survey] = await tx
      .select({ enabled: surveys.testModeEnabled })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .for('update');
    if (!survey) throw new Error('NOT_FOUND');

    await tx
      .update(surveys)
      .set(survey.enabled ? { testContactColumns: scheme } : { contactColumns: scheme })
      .where(eq(surveys.id, surveyId));
  });
}

/**
 * 업로드 마법사 경고 카드용 — 기존 컨택 행 수.
 * 0 이면 신규 업로드, > 0 이면 통째 교체 경고 필요.
 */
export async function getExistingContactsCount(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.isTest, testFlagForScope(scope)),
      ),
    );
  return row?.total ?? 0;
}
