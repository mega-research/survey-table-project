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

/**
 * 잠금 아래에서 읽은 전역 테스트 모드 플래그를 세션 기준 쓰기 파티션으로 환산한다.
 *
 * 게스트는 읽기와 동일하게 항상 real 파티션에 쓴다. read 는 real 인데 write 만 test 로
 * 가는 비대칭을 막는 것이 목적이다 — 그 비대칭은 게스트가 자기 쓴 레코드를 못 보거나,
 * 테스트 파티션 정리 로직을 대신 트리거하는 사고로 이어진다.
 *
 * 순수 동기 함수로 유지한다. 게스트 판정(isGuest)은 호출부가 `db.transaction` 을 열고
 * `FOR UPDATE`/`FOR SHARE` 로 surveys 행을 잠그기 전에 `isGuestViewer()` 로 미리 구해
 * 인자로 넘긴다 — 잠금을 쥔 채로 Supabase auth 왕복(`auth/v1/user`)을 하면 그 네트워크
 * RTT 만큼 행 잠금이 유지되어 동시 요청과 pgBouncer 커넥션을 블록하기 때문이다.
 */
export function resolveWriteScopeIsTest(flagEnabled: boolean, isGuest: boolean): boolean {
  if (isGuest) return false;
  return flagEnabled;
}

export const getOperationsDataScope = cache(loadOperationsDataScope);

export const responseScopeCondition = (scope: OperationsDataScope) =>
  eq(surveyResponses.isTest, testFlagForScope(scope));

export const targetScopeCondition = (scope: OperationsDataScope) =>
  eq(contactTargets.isTest, testFlagForScope(scope));

export const campaignScopeCondition = (scope: OperationsDataScope) =>
  eq(mailCampaigns.isTest, testFlagForScope(scope));
