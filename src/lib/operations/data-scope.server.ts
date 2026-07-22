import 'server-only';

import { eq } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db';
import { contactTargets, mailCampaigns, surveyResponses, surveys } from '@/db/schema';

export type OperationsDataScope = 'real' | 'test';

export function testFlagForScope(scope: OperationsDataScope): boolean {
  return scope === 'test';
}

export async function loadOperationsDataScope(
  surveyId: string,
): Promise<OperationsDataScope> {
  const [row] = await db
    .select({ enabled: surveys.testModeEnabled })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);

  if (!row) throw new Error('설문을 찾을 수 없습니다.');
  return row.enabled ? 'test' : 'real';
}

export const getOperationsDataScope = cache(loadOperationsDataScope);

export const responseScopeCondition = (scope: OperationsDataScope) =>
  eq(surveyResponses.isTest, testFlagForScope(scope));

export const targetScopeCondition = (scope: OperationsDataScope) =>
  eq(contactTargets.isTest, testFlagForScope(scope));

export const campaignScopeCondition = (scope: OperationsDataScope) =>
  eq(mailCampaigns.isTest, testFlagForScope(scope));
