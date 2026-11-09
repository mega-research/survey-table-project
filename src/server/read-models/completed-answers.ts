import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import 'server-only';

import { completedResponse, notDeletedResponse } from '@/server/response-filters';
import { db, type DbOrTx } from '@/db';
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
 *
 * `executor` — 제출 시점 하드 차단(response-completion)이 셀 잠금을 잡은 트랜잭션 안에서 다시
 * 셀 때 넘긴다. 생략하면 공용 db 다.
 */
export async function loadCompletedQuotaSubjects(
  surveyId: string,
  scope: OperationsDataScope,
  options: { withAttrs: boolean; executor?: DbOrTx },
): Promise<QuotaSubject[]> {
  const rows = await loadCompletedRows(surveyId, scope, options, undefined);
  return rows.map((r) => r.subject);
}

/**
 * 같은 모수를 한 번 읽어 **전체**와 **담당 범위 몫**으로 가른다 — 외주 링크의 쿼터 투영
 * (fieldwork-multi-company 티켓 08)이 마감은 전체로, 내 달성 수는 몫으로 세야 해서다.
 *
 * `shareCondition` 은 응답 행에 거는 담당 범위 술어다 — 호출자가 `server/fieldwork-share` 의
 * `shareTargetCondition(share, surveyResponses.contactTargetId)` 로 만들어 넘긴다(같이 맡은 대상은 맡은 링크마다
 * 몫이고, 대상 없는 공개 응답은 나눈 링크의 몫이 아니다). `undefined`(= `all`)면 몫 = 전체다. 해석 모듈을 여기서
 * import 하지 않는 것은 이 로더가 응답 제출 경로(쿼터 집행)에도 실려 있어 주체 판정 사슬을 끌어오지 않게 하려는 것이다.
 * 따로 두 번 읽지 않는 것은 두 모수가 한 시점의 같은 행이어야 「몫 ⊂ 전체」가 성립하기 때문이다.
 */
export async function loadCompletedQuotaSubjectsWithShare(
  surveyId: string,
  scope: OperationsDataScope,
  options: { withAttrs: boolean; shareCondition: SQL | undefined },
): Promise<{ all: QuotaSubject[]; mine: QuotaSubject[] }> {
  const rows = await loadCompletedRows(surveyId, scope, options, options.shareCondition);
  return {
    all: rows.map((r) => r.subject),
    mine: rows.filter((r) => r.inShare).map((r) => r.subject),
  };
}

async function loadCompletedRows(
  surveyId: string,
  scope: OperationsDataScope,
  options: { withAttrs: boolean; executor?: DbOrTx },
  shareCondition: SQL | undefined,
): Promise<{ subject: QuotaSubject; inShare: boolean }[]> {
  const dbc = options.executor ?? db;
  const rows = await dbc
    .select({
      questionResponses: surveyResponses.questionResponses,
      contactTargetId: surveyResponses.contactTargetId,
      inShare: shareCondition
        ? sql<boolean>`${shareCondition}`.mapWith(Boolean)
        : sql<boolean>`TRUE`.mapWith(Boolean),
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
    const targets = await dbc
      .select({ id: contactTargets.id, attrs: contactTargets.attrs })
      .from(contactTargets)
      .where(inArray(contactTargets.id, targetIds));
    for (const t of targets) attrsById.set(t.id, t.attrs ?? {});
  }

  return rows.map((r) => ({
    subject: {
      answers: decryptQuestionResponses((r.questionResponses ?? {}) as Record<string, unknown>),
      attrs: (r.contactTargetId != null ? attrsById.get(r.contactTargetId) : undefined) ?? null,
    },
    inShare: r.inShare,
  }));
}

/** 응답 하나에 연결된 조사 대상의 attrs. 연결이 없거나 대상이 사라졌으면 null. */
export async function loadContactAttrsForQuota(
  contactTargetId: string | null | undefined,
  executor: DbOrTx = db,
): Promise<Record<string, string> | null> {
  if (!contactTargetId) return null;
  const [target] = await executor
    .select({ attrs: contactTargets.attrs })
    .from(contactTargets)
    .where(eq(contactTargets.id, contactTargetId));
  return target ? (target.attrs ?? {}) : null;
}
