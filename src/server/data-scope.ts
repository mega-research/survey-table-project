import { cache } from 'react';

import { cookies } from 'next/headers';

import { eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { contactTargets, mailCampaigns, surveyResponses, surveys } from '@/db/schema';
import { isGuestViewer } from '@/lib/auth/guest-viewer';
import { TEST_VIEW_COOKIE_VALUE, testViewCookieName } from '@/lib/operations/test-view-cookie';

export type OperationsDataScope = 'real' | 'test';

export function testFlagForScope(scope: OperationsDataScope): boolean {
  return scope === 'test';
}

/**
 * 이 브라우저가 콘솔을 테스트 파티션으로 보기로 했는가 (`lib/operations/test-view-cookie`).
 * 요청 밖(백그라운드 잡 등)에서는 쿠키가 없으니 실데이터 쪽으로 접는다.
 * 쿠키 읽기는 네트워크 왕복이 없어 잠금을 쥔 트랜잭션 안에서 불러도 된다.
 */
export async function readBrowserTestView(surveyId: string): Promise<boolean> {
  try {
    const store = await cookies();
    return store.get(testViewCookieName(surveyId))?.value === TEST_VIEW_COOKIE_VALUE;
  } catch {
    return false;
  }
}

/**
 * 콘솔이 보는 파티션. 테스트 파티션은 세 조건이 모두 맞을 때만이다 —
 * 설문의 테스트 모드가 켜져 있고(전역), 이 브라우저가 테스트로 보기로 했고(쿠키), 게스트가 아니다.
 * 전역 플래그만으로 정하던 때는 한 사람이 켜면 모든 사람의 콘솔이 테스트 데이터로 바뀌었다.
 */
export async function loadOperationsDataScope(surveyId: string): Promise<OperationsDataScope> {
  // 설문 존재 검증을 건너뛰지 않도록 게스트여도 조회는 그대로 수행하고 반환값만 덮는다.
  const [isGuest, browserTestView, rows] = await Promise.all([
    isGuestViewer(),
    readBrowserTestView(surveyId),
    db
      .select({ enabled: surveys.testModeEnabled })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1),
  ]);

  const row = rows[0];
  if (!row) throw new Error('설문을 찾을 수 없습니다.');
  return resolveWriteScopeIsTest(row.enabled, isGuest, browserTestView) ? 'test' : 'real';
}

/**
 * 잠금 아래에서 읽은 전역 테스트 모드 플래그를 세션 기준 쓰기 파티션으로 환산한다.
 * 읽기(loadOperationsDataScope)도 같은 함수를 써서 읽기·쓰기 파티션이 갈리지 않는다.
 *
 * 브라우저가 테스트로 보기로 했어도(browserTestView) 전역 플래그가 꺼져 있으면 실데이터다 —
 * 쿠키는 보기 선택일 뿐 테스트 환경을 여는 권한이 아니다.
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
export function resolveWriteScopeIsTest(
  flagEnabled: boolean,
  isGuest: boolean,
  browserTestView: boolean,
): boolean {
  if (isGuest) return false;
  return flagEnabled && browserTestView;
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
 * 플래그를 resolveWriteScopeIsTest 로 세션(게스트 여부 + 이 브라우저의 보기 쿠키) 기준 파티션으로 환산한다.
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
  const browserTestView = await readBrowserTestView(surveyId);
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
  const isTest = resolveWriteScopeIsTest(row.enabled, isGuest, browserTestView);
  return { isTest, scope: isTest ? 'test' : 'real', row };
}

export const getOperationsDataScope = cache(loadOperationsDataScope);

export const responseScopeCondition = (scope: OperationsDataScope) =>
  eq(surveyResponses.isTest, testFlagForScope(scope));

export const targetScopeCondition = (scope: OperationsDataScope) =>
  eq(contactTargets.isTest, testFlagForScope(scope));

export const campaignScopeCondition = (scope: OperationsDataScope) =>
  eq(mailCampaigns.isTest, testFlagForScope(scope));
