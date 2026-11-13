import { and, eq, sql } from 'drizzle-orm';
import 'server-only';

import { db, type DbOrTx } from '@/db';
import { surveyResponses, surveys } from '@/db/schema/surveys';
import { type OperationsDataScope, responseScopeCondition } from '@/server/data-scope';
import { completedResponse, notDeletedResponse } from '@/server/response-filters';
import {
  cellKeyOf,
  countCell,
  deriveCategoryIds,
  findTarget,
  needsContactAttrs,
} from '@/lib/quota/matching';
import {
  normalizeQuotaConfig,
  type NormalizedQuotaConfig,
  quotaTotalTarget,
} from '@/lib/quota/normalize';

import { loadCompletedQuotaSubjects, loadContactAttrsForQuota } from './completed-answers';
import { getFieldworkCompletedCounts } from './fieldwork-completions';

/**
 * 쿼터 판정 읽기 조각 — 플랜 읽기 · 판정 대상의 셀 분류 · 셀 완료 수 · 「완료」 조건의 전체 완료 수.
 *
 * 입장 판정(server/quota checkQuota)·제출 시점 하드 차단과 초과 표식(survey-response
 * response-completion·submitted-answers)이 같은 분류 함수·같은 모수를 써야 "재확인은 통과인데
 * 제출은 마감" 이 규칙 차이에서 나오지 않는다. 도메인 간 직접 import 가 막혀 있어 두 도메인이
 * 각자 같은 사슬을 복제하던 것을 여기로 모았다. 읽기만 한다 — 마킹(quotaful_out)은 도메인 몫.
 */

/**
 * 설문의 쿼터 플랜(정규화). 미설정이면 null.
 *
 * `executor` — 제출 판정이 잠금을 쥔 트랜잭션 안에서 플랜을 다시 읽을 때 넘긴다(잠금을 기다리는 사이
 * 운영자가 목표를 바꿨을 수 있다). 생략하면 공용 db 다.
 */
export async function loadQuotaPlan(
  surveyId: string,
  executor: DbOrTx = db,
): Promise<NormalizedQuotaConfig | null> {
  const row = await executor.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { quotaConfig: true },
  });
  // JSONB 드리프트 보정 — 소비처(deriveCategoryIds·findTarget·countCell)는
  // dimensions·cells·categories 를 배열로 순회한다.
  return normalizeQuotaConfig(row?.quotaConfig ?? null);
}

/** 판정 대상이 속한 목표 셀. 셀 잠금 키·목표·모수 로더에 attrs 가 필요한지를 함께 싣는다. */
export interface QuotaTargetCell {
  categoryIds: string[];
  /** 설문+셀 키 advisory lock 의 두 번째 키 (cellKeyOf). */
  cellKey: string;
  target: number;
  withAttrs: boolean;
}

/**
 * 평문 답 + 서버가 읽은 조사 대상 attrs 로 셀을 분류한다. 미분류·목표 없는 셀은 null
 * (쿼터에 걸리지 않고 통과). attrs 는 응답 행의 연결(contactTargetId)로 서버가 읽는다 —
 * 클라이언트가 보낸 값은 받지 않는다.
 */
export async function resolveQuotaTargetCell(
  config: NormalizedQuotaConfig,
  plainAnswers: Record<string, unknown>,
  contactTargetId: string | null,
  /** 트랜잭션 안에서 부르면 반드시 그 tx 를 넘긴다 — 전역 db 로 새면 풀(max 5)을 잡아먹어 교착한다. */
  executor: DbOrTx = db,
): Promise<QuotaTargetCell | null> {
  const withAttrs = needsContactAttrs(config);
  const attrs = withAttrs ? await loadContactAttrsForQuota(contactTargetId, executor) : null;
  const categoryIds = deriveCategoryIds(config, { answers: plainAnswers, attrs });
  if (!categoryIds) return null;
  const target = findTarget(config, categoryIds);
  if (target === null) return null;
  return { categoryIds, cellKey: cellKeyOf(categoryIds), target, withAttrs };
}

/**
 * 셀의 현재 완료 수 — 집행 모수는 언제나 실응답(real). 하드 차단은 셀 잠금을 잡은 트랜잭션을
 * executor 로 넘겨 잠금 아래에서 다시 센다.
 */
export async function countQuotaCellCompleted(
  executor: DbOrTx,
  surveyId: string,
  config: NormalizedQuotaConfig,
  cell: QuotaTargetCell,
): Promise<number> {
  const subjects = await loadCompletedQuotaSubjects(surveyId, 'real', {
    withAttrs: cell.withAttrs,
    executor,
  });
  return countCell(config, cell.categoryIds, subjects);
}

/**
 * 「완료」 조건이 세는 수 — 온라인 완료 + 실사 완료 처리 (CONTEXT.md 「완료 조건」).
 *
 * 실사 현황의 「완료」 카드와 「실사 완료 처리」 카드를 더한 값과 같은 정의다: 온라인 완료는 쿼터 모수와
 * 같은 조건(completed · 비삭제), 실사 완료 처리는 온라인 응답을 마치지 않았는데 담당자가 완료 결과코드를
 * 기록한 조사 대상이다(`fieldwork-completions` — 온라인 완료와 겹치는 대상은 빼서 두 번 세지 않는다).
 * 자격미달·쿼터마감·불량은 세지 않는다.
 *
 * 입장 판정·페이지 재확인(`checkQuota`)·제출 시점 하드 차단·쿼터마감 다시 열기·현황판이 이 셈 하나를 쓴다.
 * 집행은 언제나 실응답(real)이고 현황판만 표시용으로 'test' 를 넘긴다. 제출 판정은 잠금을 쥔
 * 트랜잭션을 executor 로 넘긴다.
 */
export async function countQuotaTotalCompleted(
  executor: DbOrTx,
  surveyId: string,
  scope: OperationsDataScope = 'real',
): Promise<number> {
  const [online] = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        completedResponse,
        notDeletedResponse,
        responseScopeCondition(scope),
      ),
    );
  const fieldwork = await getFieldworkCompletedCounts([surveyId], scope === 'test', executor);
  return (online?.total ?? 0) + (fieldwork.get(surveyId) ?? 0);
}

/**
 * 「완료」 조건이 찼는가 — 조건이 없으면 false. 집행 여부(`enabled`)는 호출자가 본다
 * (판정 지점마다 집행·진행 중 마감 옵션을 읽는 자리가 다르다).
 */
export async function isQuotaTotalFull(
  executor: DbOrTx,
  surveyId: string,
  config: NormalizedQuotaConfig,
): Promise<boolean> {
  const target = quotaTotalTarget(config);
  if (target === null) return false;
  return (await countQuotaTotalCompleted(executor, surveyId)) >= target;
}
