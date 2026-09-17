import { and, eq } from 'drizzle-orm';
import 'server-only';

import { completedResponse, notDeletedResponse } from '@/server/response-filters';
import { db } from '@/db';
import { surveyResponses } from '@/db/schema/surveys';
import { decryptQuestionResponses } from '@/lib/crypto/response-pii';
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
 */
export async function loadCompletedPlainAnswers(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select({ questionResponses: surveyResponses.questionResponses })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        completedResponse,
        notDeletedResponse,
        responseScopeCondition(scope),
      ),
    );
  return rows.map((r) =>
    decryptQuestionResponses((r.questionResponses ?? {}) as Record<string, unknown>),
  );
}
