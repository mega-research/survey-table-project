import { and, eq, inArray } from 'drizzle-orm';
import 'server-only';

import { completedResponse, notDeletedResponse } from '@/server/response-filters';
import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { surveyResponses } from '@/db/schema/surveys';
import { decryptQuestionResponses } from '@/lib/crypto/response-pii';
import type { QuotaSubject } from '@/lib/quota/matching';
import {
  type OperationsDataScope,
  responseScopeCondition,
} from '@/server/data-scope';

/**
 * 쿼터 모수의 단일 정의 — 설문의 완료·비삭제·해당 파티션 응답을 전부 읽어 평문 답으로 돌려준다.
 *
 * 마감 집행(quota.service.checkQuota)·완료 시점 초과 감지(response.service)·현황판
 * (server/quota/services/quota-status.server)이 같은 모수를 세야 "차단은 됐는데 현황판은 여유" 같은
 * 불일치가 생기지 않는다. 집행 경로는 언제나 scope='real' 을 넘긴다 — 테스트 파티션은
 * 쿼터를 소비하지 않는다. 현황판만 표시용으로 'test' 를 넘길 수 있다.
 *
 * 복호화는 응답 단위 컨텍스트(responseId) 없이 수행한다 — 세 호출부 모두 그렇게 해 왔고,
 * 실패 로그에 응답 id 가 필요해지면 여기서 한 번에 바꾼다.
 *
 * `withAttrs` — 조사 대상 속성형 차원이 있는 플랜(`needsContactAttrs`)만 켠다. 켜면 응답에 연결된
 * 조사 대상의 attrs 를 한 번 더 읽어 싣고, 끄면 attrs 는 전부 null 이다. 익명 응답은 언제나 null.
 * pii 는 읽지 않는다 — attrs 는 평문이고 속성형 차원의 소스는 attrs 뿐이다.
 */
export async function loadCompletedQuotaSubjects(
  surveyId: string,
  scope: OperationsDataScope,
  options: { withAttrs: boolean },
): Promise<QuotaSubject[]> {
  const rows = await db
    .select({
      questionResponses: surveyResponses.questionResponses,
      contactTargetId: surveyResponses.contactTargetId,
    })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        completedResponse,
        notDeletedResponse,
        responseScopeCondition(scope),
      ),
    );

  const attrsById = new Map<string, Record<string, string>>();
  const targetIds = options.withAttrs
    ? [...new Set(rows.map((r) => r.contactTargetId).filter((id): id is string => id != null))]
    : [];
  if (targetIds.length > 0) {
    const targets = await db
      .select({ id: contactTargets.id, attrs: contactTargets.attrs })
      .from(contactTargets)
      .where(inArray(contactTargets.id, targetIds));
    for (const t of targets) attrsById.set(t.id, t.attrs ?? {});
  }

  return rows.map((r) => ({
    answers: decryptQuestionResponses((r.questionResponses ?? {}) as Record<string, unknown>),
    attrs: (r.contactTargetId != null ? attrsById.get(r.contactTargetId) : undefined) ?? null,
  }));
}

/** 응답 하나에 연결된 조사 대상의 attrs. 연결이 없거나 대상이 사라졌으면 null. */
export async function loadContactAttrsForQuota(
  contactTargetId: string | null | undefined,
): Promise<Record<string, string> | null> {
  if (!contactTargetId) return null;
  const [target] = await db
    .select({ attrs: contactTargets.attrs })
    .from(contactTargets)
    .where(eq(contactTargets.id, contactTargetId));
  return target ? (target.attrs ?? {}) : null;
}
