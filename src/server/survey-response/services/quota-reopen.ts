import { and, eq, isNull, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { decryptQuestionResponses } from '@/lib/crypto/response-pii';
import { logger } from '@/lib/logger';
import {
  countQuotaCellCompleted,
  loadQuotaPlan,
  resolveQuotaTargetCell,
} from '@/server/read-models/quota-cell';

/**
 * 쿼터 마감 응답 다시 열기 — 응답자가 다시 들어왔을 때 그 응답의 셀에 지금 자리가 있으면
 * quotaful_out 을 drop 으로 되돌린다. 호출부는 drop 을 평소의 되살리기 경로(→ in_progress)로
 * 이어 가므로 남겨 둔 답·진행 위치가 그대로 복원된다.
 *
 * 운영 중 목표를 늘리는 일이 잦다(2026-10-22 팹리스 수요기업 조사 — 25 → 30). 전에는 마감이
 * 한 번 찍히면 재진입 판정이 목표를 다시 보지 않아, 정원을 늘려도 막힌 사람은 계속 막혔다.
 *
 * 자리를 예약하지 않는다. 판정과 되살리기 사이에 다른 응답이 셀을 채울 수 있고, 다시 연 사람이
 * 여럿이면 남은 자리보다 많이 들어온다 — 초과는 종전대로 페이지 재확인(checkQuota)과 제출 시점
 * 하드 차단(진행 중 마감)이 막는다. 여기서 막는 것은 "자리가 없는데 들여보내기" 뿐이다.
 *
 * 판정은 입장 판정(checkQuota)과 같은 사슬이다 — 쿼터가 꺼졌거나, 미분류이거나, 목표 없는
 * 셀이면 자리가 있는 것으로 본다. 테스트 응답은 손대지 않는다(테스트 재시작 경로가 따로 있다).
 * 되살리기는 status='quotaful_out' 조건부 UPDATE 라 동시 재진입에도 한 번만 바뀐다.
 *
 * @returns 이 호출이 drop 으로 되돌렸으면 true
 */
export async function reopenQuotaClosedResponse(responseId: string): Promise<boolean> {
  const [row] = await db
    .select({
      surveyId: surveyResponses.surveyId,
      status: surveyResponses.status,
      isTest: surveyResponses.isTest,
      contactTargetId: surveyResponses.contactTargetId,
      questionResponses: surveyResponses.questionResponses,
    })
    .from(surveyResponses)
    .where(and(eq(surveyResponses.id, responseId), isNull(surveyResponses.deletedAt)))
    .limit(1);
  if (!row || row.status !== 'quotaful_out' || row.isTest) return false;

  const plan = await loadQuotaPlan(row.surveyId);
  if (plan?.enabled) {
    // 셀 분류는 평문 답으로 한다 — 저장분은 PII 문항이 암호문이다.
    const plain = decryptQuestionResponses(
      (row.questionResponses ?? {}) as Record<string, unknown>,
      { responseId },
    );
    const cell = await resolveQuotaTargetCell(plan, plain, row.contactTargetId);
    if (cell && (await countQuotaCellCompleted(db, row.surveyId, plan, cell)) >= cell.target) {
      return false;
    }
  }

  const reopened = await db
    .update(surveyResponses)
    .set({
      status: 'drop',
      // 언제 다시 열렸는지 남긴다 — 응답 내역에서 "마감됐다가 이어 간 응답" 을 가릴 근거.
      metadata: sql`jsonb_set(
        COALESCE(${surveyResponses.metadata}, '{}'::jsonb),
        '{quotaReopenedAt}',
        to_jsonb(now()::text),
        true
      )`,
    })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        isNull(surveyResponses.deletedAt),
        eq(surveyResponses.status, 'quotaful_out'),
      ),
    )
    .returning({ id: surveyResponses.id });
  if (reopened.length === 0) return false;

  logger.info(
    { surveyId: row.surveyId, responseId },
    '[quota] 목표에 자리가 생겨 쿼터 마감 응답을 다시 열었다',
  );
  return true;
}
