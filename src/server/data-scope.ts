import { cache } from 'react';

import { cookies } from 'next/headers';

import { eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { contactTargets, mailCampaigns, surveyResponses, surveys } from '@/db/schema';
import { isExternalViewer } from '@/lib/auth/external-viewer';
import { TEST_VIEW_COOKIE_VALUE, testViewCookieName } from '@/lib/operations/test-view-cookie';
import { isInternalUser } from '@/shared/contracts/auth';

import { isLinkActor, type Actor } from './survey-access';

export type OperationsDataScope = 'real' | 'test';

/**
 * 외부 계정(게스트·실사) 화면이 보는 파티션 — **언제나 실데이터**다 (스펙 §11-3, 티켓 21·22·25).
 *
 * `loadOperationsDataScope` 를 태우면 결론은 같지만 세션과 설문을 한 번씩 더 읽는다.
 * 외부 콘솔은 전역 테스트 모드를 아예 묻지 않는 화면이라 상수로 고정하고, 그 계약을
 * **여기** 적는다 — 파티션 규칙의 집이 두 곳이 되면 담당 연구원이 테스트 모드를 켰을 때
 * 외부 계정이 무엇을 보는지가 화면마다 갈린다.
 */
export const EXTERNAL_VIEWER_DATA_SCOPE: OperationsDataScope = 'real';

export function testFlagForScope(scope: OperationsDataScope): boolean {
  return scope === 'test';
}

/**
 * 이 주체가 **내부 계정이 아닌가** — 파티션 술어의 주체 판 (ADR-0026, 티켓 06).
 *
 * `isExternalViewer()` 는 `requireActiveAccount()` 를 부르므로 **링크 세션에서는 쓸 수 없다**
 * (계정이 없어 그 문에서 던진다). 그래서 주체를 받는 형제를 둔다 — 판정은 같은 문장이다:
 * 「내부가 아니면 real」. 술어를 「게스트인가」가 아니라 이렇게 적어 둔 것이 여기서 값을 한다
 * (주체 종류가 하나 늘었는데 판정은 그대로다).
 */
export function isExternalActor(actor: Actor): boolean {
  return isLinkActor(actor) || !isInternalUser(actor.userType);
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
 * 이 요청이 보는 파티션. 테스트 파티션은 세 조건이 모두 맞을 때만이다 —
 * 설문의 테스트 모드가 켜져 있고(전역), 이 브라우저가 테스트로 보기로 했고(쿠키), 외부 주체가 아니다.
 * 전역 플래그만으로 정하던 때는 한 사람이 켜면 모든 사람의 콘솔이 테스트 데이터로 바뀌었다.
 *
 * `actor` 를 주면 그것으로 판정하고, 주지 않으면 세션을 읽는다(`isExternalViewer`). 주는
 * 쪽은 링크 주체가 지날 수 있는 자리 — scoped procedure 와 `/fw` 콘솔 RSC — 이고, 세션을
 * 읽는 쪽은 계정만 지나는 admin·게스트 RSC 다. **읽기·쓰기가 같은 술어를 쓰는 것이 계약이다**
 * (`resolveWriteScopeIsTest` 주석 참조).
 */
export async function loadOperationsDataScope(
  surveyId: string,
  actor?: Actor,
): Promise<OperationsDataScope> {
  // 설문 존재 검증을 건너뛰지 않도록 외부 계정이어도 조회는 그대로 수행하고 반환값만 덮는다.
  const [isExternal, browserTestView, rows] = await Promise.all([
    actor === undefined ? isExternalViewer() : Promise.resolve(isExternalActor(actor)),
    readBrowserTestView(surveyId),
    db
      .select({ enabled: surveys.testModeEnabled })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1),
  ]);

  const row = rows[0];
  if (!row) throw new Error('설문을 찾을 수 없습니다.');
  // 외부 주체(게스트·실사 계정·외주 실사 링크)는 전역 테스트 모드와 무관하게 항상 실데이터를 본다.
  return resolveWriteScopeIsTest(row.enabled, isExternal, browserTestView) ? 'test' : 'real';
}

/**
 * 잠금 아래에서 읽은 전역 테스트 모드 플래그를 세션 기준 쓰기 파티션으로 환산한다.
 * 읽기(loadOperationsDataScope)도 같은 함수를 써서 읽기·쓰기 파티션이 갈리지 않는다.
 *
 * 브라우저가 테스트로 보기로 했어도(browserTestView) 전역 플래그가 꺼져 있으면 실데이터다 —
 * 쿠키는 보기 선택일 뿐 테스트 환경을 여는 권한이 아니다.
 *
 * 외부 계정은 읽기와 동일하게 항상 real 파티션에 쓴다. read 는 real 인데 write 만 test 로
 * 가는 비대칭을 막는 것이 목적이다 — 그 비대칭은 외부 계정이 자기 쓴 레코드를 못 보거나,
 * 테스트 파티션 정리 로직을 대신 트리거하는 사고로 이어진다.
 *
 * 순수 동기 함수로 유지한다. 외부 계정 판정(isExternal)은 호출부가 `db.transaction` 을 열고
 * `FOR UPDATE`/`FOR SHARE` 로 surveys 행을 잠그기 전에 `isExternalViewer()` 로 미리 구해
 * 인자로 넘긴다 — 잠금을 쥔 채로 Supabase auth 왕복(`auth/v1/user`)을 하면 그 네트워크
 * RTT 만큼 행 잠금이 유지되어 동시 요청과 pgBouncer 커넥션을 블록하기 때문이다.
 */
export function resolveWriteScopeIsTest(
  flagEnabled: boolean,
  isExternal: boolean,
  browserTestView: boolean,
): boolean {
  if (isExternal) return false;
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
 * 플래그를 resolveWriteScopeIsTest 로 세션(외부 주체 여부 + 이 브라우저의 보기 쿠키) 기준 파티션으로 환산한다.
 *
 * - lock:'update'|'share' 는 같은 트랜잭션(tx)에서 호출해야 잠금이 의미가 있다. 모드 전환과
 *   쓰기를 직렬화하고 클라이언트가 보낸 스코프 값을 신뢰하지 않기 위한 잠금이다.
 * - lock:'none' 은 잠금 없는 limit(1) 조회 — 쓰기 WHERE 의 isTest 조건만으로 파티션이
 *   보호되는 경로(예: 캠페인 취소)용.
 * - 설문이 없으면 null 을 돌려준다. 어떤 에러를 던질지(NOT_FOUND, '설문을 찾을 수 없습니다.' 등)는
 *   호출부의 기존 계약이므로 여기서 정하지 않는다.
 * - isExternal 은 호출부가 잠금 전에 미리 구해 넘긴다(위 resolveWriteScopeIsTest 주석 참조).
 * - 투영 키 enabled 는 기존 호출부·테스트 스텁이 공유하는 이름이라 그대로 둔다.
 */
export async function lockWriteScope<K extends SurveyColumnKey = never>(
  executor: DbOrTx,
  surveyId: string,
  isExternal: boolean,
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
  const isTest = resolveWriteScopeIsTest(row.enabled, isExternal, browserTestView);
  return { isTest, scope: isTest ? 'test' : 'real', row };
}

export const getOperationsDataScope = cache(loadOperationsDataScope);

export const responseScopeCondition = (scope: OperationsDataScope) =>
  eq(surveyResponses.isTest, testFlagForScope(scope));

export const targetScopeCondition = (scope: OperationsDataScope) =>
  eq(contactTargets.isTest, testFlagForScope(scope));

export const campaignScopeCondition = (scope: OperationsDataScope) =>
  eq(mailCampaigns.isTest, testFlagForScope(scope));
