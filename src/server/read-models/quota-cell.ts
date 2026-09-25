import { eq } from 'drizzle-orm';
import 'server-only';

import { db, type DbOrTx } from '@/db';
import { surveys } from '@/db/schema/surveys';
import {
  cellKeyOf,
  countCell,
  deriveCategoryIds,
  findTarget,
  needsContactAttrs,
} from '@/lib/quota/matching';
import { normalizeQuotaConfig, type NormalizedQuotaConfig } from '@/lib/quota/normalize';

import { loadCompletedQuotaSubjects, loadContactAttrsForQuota } from './completed-answers';

/**
 * 쿼터 판정 읽기 조각 — 플랜 읽기 · 판정 대상의 셀 분류 · 셀 완료 수.
 *
 * 입장 판정(server/quota checkQuota)·제출 시점 하드 차단과 초과 표식(survey-response
 * response-completion·submitted-answers)이 같은 분류 함수·같은 모수를 써야 "재확인은 통과인데
 * 제출은 마감" 이 규칙 차이에서 나오지 않는다. 도메인 간 직접 import 가 막혀 있어 두 도메인이
 * 각자 같은 사슬을 복제하던 것을 여기로 모았다. 읽기만 한다 — 마킹(quotaful_out)은 도메인 몫.
 */

/** 설문의 쿼터 플랜(정규화). 미설정이면 null. */
export async function loadQuotaPlan(surveyId: string): Promise<NormalizedQuotaConfig | null> {
  const row = await db.query.surveys.findFirst({
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
