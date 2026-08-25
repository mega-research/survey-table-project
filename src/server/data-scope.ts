import { cache } from 'react';

import { eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { contactTargets, mailCampaigns, surveyResponses, surveys } from '@/db/schema';
import { isGuestViewer } from '@/lib/auth/guest-viewer';

export type OperationsDataScope = 'real' | 'test';

export function testFlagForScope(scope: OperationsDataScope): boolean {
  return scope === 'test';
}

export async function loadOperationsDataScope(surveyId: string): Promise<OperationsDataScope> {
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

type SurveyRow = typeof surveys.$inferSelect;
type SurveyColumnKey = keyof SurveyRow;

export type WriteScopeLock = 'update' | 'share' | 'none';

export interface LockedWriteScope<K extends SurveyColumnKey = never> {
  /** 이 세션의 쓰기 파티션 — resolveWriteScopeIsTest 결과. */
  isTest: boolean;
  scope: OperationsDataScope;
  /** 잠금 아래에서 읽은 surveys 행. enabled 는 전역 테스트 모드 플래그, 나머지는 columns 로 요청한 컬럼. */
  row: { enabled: boolean } & Pick<SurveyRow, K>;
}

/**
 * 쓰기 파티션 확정 절차의 단일 구현 — surveys 행을 잠그고(또는 읽고) 전역 테스트 모드
 * 플래그를 resolveWriteScopeIsTest 로 세션 기준 파티션으로 환산한다.
 *
 * - lock:'update'|'share' 는 같은 트랜잭션(tx)에서 호출해야 잠금이 의미가 있다. 모드 전환과
 *   쓰기를 직렬화하고 클라이언트가 보낸 스코프 값을 신뢰하지 않기 위한 잠금이다.
 * - lock:'none' 은 잠금 없는 limit(1) 조회 — 쓰기 WHERE 의 isTest 조건만으로 파티션이
 *   보호되는 경로(예: 캠페인 취소)용.
 * - 설문이 없으면 null 을 돌려준다. 어떤 에러를 던질지(NOT_FOUND, '설문을 찾을 수 없습니다.' 등)는
 *   호출부의 기존 계약이므로 여기서 정하지 않는다.
 * - isGuest 는 호출부가 잠금 전에 미리 구해 넘긴다(위 resolveWriteScopeIsTest 주석 참조).
 * - 투영 키 enabled 는 기존 호출부·테스트 스텁이 공유하는 이름이라 그대로 둔다.
 */
export async function lockWriteScope<K extends SurveyColumnKey = never>(
  executor: DbOrTx,
  surveyId: string,
  isGuest: boolean,
  opts: { lock: WriteScopeLock; columns?: readonly K[] },
): Promise<LockedWriteScope<K> | null> {
  const selection: Record<string, PgColumn> = { enabled: surveys.testModeEnabled };
  for (const key of opts.columns ?? []) selection[key] = surveys[key];
  const query = executor.select(selection).from(surveys).where(eq(surveys.id, surveyId));
  const rows =
    opts.lock === 'update'
      ? await query.for('update')
      : opts.lock === 'share'
        ? await query.for('share')
        : await query.limit(1);
  // selection 이 동적이라 drizzle 추론이 Record<string, unknown> 으로 넓어진다 — 키는 위에서
  // enabled + columns 로 고정했으므로 행 타입을 되돌린다.
  const row = rows[0] as LockedWriteScope<K>['row'] | undefined;
  if (!row) return null;
  const isTest = resolveWriteScopeIsTest(row.enabled, isGuest);
  return { isTest, scope: isTest ? 'test' : 'real', row };
}

export const getOperationsDataScope = cache(loadOperationsDataScope);

export const responseScopeCondition = (scope: OperationsDataScope) =>
  eq(surveyResponses.isTest, testFlagForScope(scope));

export const targetScopeCondition = (scope: OperationsDataScope) =>
  eq(contactTargets.isTest, testFlagForScope(scope));

export const campaignScopeCondition = (scope: OperationsDataScope) =>
  eq(mailCampaigns.isTest, testFlagForScope(scope));
