import 'server-only';

import { eq, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { questions, responseAnswers } from '@/db/schema';
import { normalizeToAnswers } from '@/lib/response-normalizer';

// db 또는 transaction(tx) 둘 다 허용. drizzle 의 update/insert/delete API 는
// PgTransaction 과 PostgresJsDatabase 모두에서 동일하게 동작하지만 타입은 분기되어 있다.
type DbOrTx =
  | typeof db
  | PgTransaction<
      PostgresJsQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >;

/**
 * response_answers 를 완전히 치환한다.
 *
 * - 기존 행을 DELETE 후 정규화된 새 행을 INSERT.
 * - 빈 응답이면 DELETE 만 수행 (INSERT 생략).
 * - questions 메타 (id, type) 는 해당 설문에서 매번 조회.
 *
 * 호출자는 트랜잭션 안에서 호출하여 partial write 를 방지한다.
 *
 * completeResponse(첫 제출) 와 saveAdminEdit(어드민 수정) 둘 다 사용.
 */
export async function replaceResponseAnswers(
  tx: DbOrTx,
  responseId: string,
  surveyId: string,
  questionResponses: Record<string, unknown>,
): Promise<void> {
  // 1. 기존 정규화 답변 전부 삭제
  await tx.delete(responseAnswers).where(eq(responseAnswers.responseId, responseId));

  // 2. 빈 응답은 INSERT 생략
  if (!questionResponses || Object.keys(questionResponses).length === 0) {
    return;
  }

  // 3. 해당 설문의 질문 메타 조회 (id + type)
  const questionList = await tx.query.questions.findMany({
    where: eq(questions.surveyId, surveyId),
    columns: { id: true, type: true },
  });

  const normalized = normalizeToAnswers(responseId, questionResponses, questionList);
  if (normalized.length === 0) return;

  await tx.insert(responseAnswers).values(normalized);
}
