import 'server-only';

import { eq } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db';
import { contactTargets, mailCampaigns, surveyResponses, surveys } from '@/db/schema';
import { isGuestViewer } from '@/lib/auth/guest-viewer';

export type OperationsDataScope = 'real' | 'test';

export function testFlagForScope(scope: OperationsDataScope): boolean {
  return scope === 'test';
}

export async function loadOperationsDataScope(
  surveyId: string,
): Promise<OperationsDataScope> {
  // 설문 존재 검증을 건너뛰지 않도록 게스트여도 조회는 그대로 수행하고 반환값만 덮는다.
  const [isGuest, rows] = await Promise.all([
    isGuestViewer(),
    db
      .select({ enabled: surveys.testModeEnabled })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1),
  ]);

  const row = rows[0];
  if (!row) throw new Error('설문을 찾을 수 없습니다.');
  // 게스트 콘솔은 전역 테스트 모드와 무관하게 항상 실데이터를 본다.
  if (isGuest) return 'real';
  return row.enabled ? 'test' : 'real';
}

export const getOperationsDataScope = cache(loadOperationsDataScope);

export const responseScopeCondition = (scope: OperationsDataScope) =>
  eq(surveyResponses.isTest, testFlagForScope(scope));

export const targetScopeCondition = (scope: OperationsDataScope) =>
  eq(contactTargets.isTest, testFlagForScope(scope));

export const campaignScopeCondition = (scope: OperationsDataScope) =>
  eq(mailCampaigns.isTest, testFlagForScope(scope));
