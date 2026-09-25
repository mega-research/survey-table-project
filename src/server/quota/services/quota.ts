import { and, eq, isNull } from 'drizzle-orm';
import 'server-only';
import type * as z from 'zod';

import { notDeletedResponse } from '@/server/response-filters';
import { db } from '@/db';
import { surveyResponses, surveys } from '@/db/schema/surveys';
import {
  countQuotaCellCompleted,
  loadQuotaPlan,
  resolveQuotaTargetCell,
} from '@/server/read-models/quota-cell';
import { resolveMidSurveyClosedMessage } from '@/lib/quota/closed-message';
import type { NormalizedQuotaConfig } from '@/lib/quota/normalize';
import type { QuotaConfig } from '@/shared/contracts/quota';
import { isConcludedResponseStatus } from '@/shared/contracts/survey-response';

import type { QuotaCheckResult } from '../domain/quota';

/**
 * 설문의 쿼터 플랜 조회. 미설정이면 null.
 *
 * 삭제된 설문은 플랜이 없는 것과 같다(티켓 17). 이 함수는 pub 표면(quota.check)도 지나므로
 * 관문에 기대지 않고 직접 건다 — 삭제 뒤 남아 있던 응답 세션이 쿼터 판정을 계속 받으면,
 * 「응답을 못 받는 설문」이 마감 계산만 조용히 이어간다.
 */
export async function getQuotaConfig(surveyId: string): Promise<NormalizedQuotaConfig | null> {
  return loadQuotaPlan(surveyId);
}

/** 설문의 쿼터 플랜 저장(덮어쓰기). 없는 설문이면 throw. */
export async function saveQuotaConfig(surveyId: string, config: QuotaConfig): Promise<QuotaConfig> {
  const [updated] = await db
    .update(surveys)
    .set({ quotaConfig: config, updatedAt: new Date() })
    .where(eq(surveys.id, surveyId))
    .returning({ quotaConfig: surveys.quotaConfig });

  if (!updated) throw new Error('쿼터 저장에 실패했습니다.');
  return updated.quotaConfig ?? config;
}

/** 판정 결과 — 모양은 domain 의 zod(QuotaCheckResult)가 소유한다. */
export type QuotaCheckOutcome = z.infer<typeof QuotaCheckResult>;

function blockedOutcome(config: NormalizedQuotaConfig): QuotaCheckOutcome {
  return {
    blocked: true,
    closedMessage: config.closedMessage,
    midSurveyClosedMessage: resolveMidSurveyClosedMessage(config),
  };
}

/**
 * 쿼터 마감 판정(집행). 미설정/미집행/미분류/미등록 셀/여유 → blocked:false.
 * 해당 셀 완료 수 ≥ target 이면 응답을 quotaful_out 으로 마킹하고 blocked:true.
 * 카운트는 완료 응답을 로드해 lib/quota 순수 함수로 센다(checkQuota·현황판 동일 소스).
 *
 * 「진행 중 마감」(ADR 0025)이 켜진 설문은 페이지마다 다시 부르므로 **재호출에 멱등**이다 —
 * 이미 쿼터마감인 응답은 모수를 세지 않고 blocked 를 그대로 돌려주고, 그 밖의 종결 응답
 * (완료·자격미달 등)에 늦게 온 확인은 아무것도 하지 않는다.
 */
export async function checkQuota(input: {
  responseId: string;
  surveyId: string;
  answers: Record<string, unknown>;
}): Promise<QuotaCheckOutcome> {
  const config = await getQuotaConfig(input.surveyId);
  if (!config || !config.enabled) return { blocked: false, closedMessage: null };

  // 응답 행 자체가 권위 소스다. 테스트 링크는 실제 quota를 소비하거나 quotaful_out으로
  // 전환되지 않으며, responseId와 surveyId가 섞인 pub mutation은 판정 전에 거부한다.
  const response = await db.query.surveyResponses.findFirst({
    where: and(
      eq(surveyResponses.id, input.responseId),
      eq(surveyResponses.surveyId, input.surveyId),
      notDeletedResponse,
    ),
    columns: { isTest: true, contactTargetId: true, status: true },
  });
  if (!response) throw new Error('쿼터 응답 범위가 일치하지 않습니다.');
  if (response.isTest) return { blocked: false, closedMessage: null };
  // 재호출 멱등 — 이미 쿼터마감이면 그대로 blocked, 그 밖의 종결 응답은 손대지 않는다.
  if (response.status === 'quotaful_out') return blockedOutcome(config);
  if (isConcludedResponseStatus(response.status)) return { blocked: false, closedMessage: null };

  // 조사 대상 attrs 는 응답 행의 연결로 서버가 읽는다 — 클라이언트가 보낸 값은 받지 않는다.
  // 미분류·목표 없는 셀은 null → 통과.
  const cell = await resolveQuotaTargetCell(config, input.answers, response.contactTargetId);
  if (!cell) return { blocked: false, closedMessage: null };

  // 집행 모수는 언제나 실응답(real) — 테스트 파티션은 쿼터를 소비하지 않는다.
  const current = await countQuotaCellCompleted(db, input.surveyId, config, cell);

  if (current >= cell.target) {
    await markQuotaFull(input.responseId, input.surveyId);
    return blockedOutcome(config);
  }
  return { blocked: false, closedMessage: null };
}

/**
 * 응답을 quotaful_out 으로 마킹. 반드시 (id + surveyId) 로 스코프하고 in_progress·비삭제 행에만 적용.
 * surveyId 가드는 pub 호출자가 타 설문의 응답을 변조하는 것을 차단하고, in_progress 가드는 종결 상태 덮어쓰기를 막는다.
 */
export async function markQuotaFull(responseId: string, surveyId: string): Promise<void> {
  await db
    .update(surveyResponses)
    .set({ status: 'quotaful_out', lastActivityAt: new Date() })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        eq(surveyResponses.surveyId, surveyId),
        isNull(surveyResponses.deletedAt),
        eq(surveyResponses.status, 'in_progress'),
      ),
    );
}
