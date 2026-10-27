import 'server-only';

import { inArray, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema';
import { extractResultCodeStatuses } from '@/lib/contacts/result-code-statuses-normalize';
import type { ContactResultCode } from '@/shared/contracts/contacts';

/**
 * 실사 완료 처리 수 — 온라인 응답을 마치지 않았는데 담당자가 완료 결과코드(positive,
 * 기본 `1.조사완료`)를 기록한 조사 대상 수.
 *
 * 진척 보고의 완료(W∪A — `report-progress` 의 `buildClosingFilter`)에서 온라인 완료(W)를
 * 뺀 나머지(A∖W)다. 온라인 완료와 겹치는 대상을 빼야 「온라인 응답 완료 N · 실사 완료 처리 M」
 * 두 숫자를 더해 읽어도 같은 사람을 두 번 세지 않는다. 결과코드는 진척 보고와 같이 한 회차라도
 * 기록했으면 센다(any-time).
 *
 * 파티션은 조사 대상과 응답이 같은 `is_test` 다. 반환은 surveyId → 수, 0건인 설문은 키가 없다.
 */
export async function getFieldworkCompletedCounts(
  surveyIds: readonly string[],
  isTest: boolean,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (surveyIds.length === 0) return result;

  const codeRows = await db
    .select({ id: surveys.id, codes: surveys.contactResultCodes })
    .from(surveys)
    .where(inArray(surveys.id, [...surveyIds]));

  const pairs = positiveCodePairs(codeRows);
  if (pairs.length === 0) return result;

  // (설문, 완료 코드) 쌍 — 설문마다 결과코드 정의가 달라 설문 id 와 함께 대조한다.
  const pairValues = sql.join(
    pairs.map(([surveyId, code]) => sql`(${surveyId}::uuid, ${code}::text)`),
    sql`, `,
  );

  const rows = await db.execute<{ survey_id: string; count: number }>(sql`
    WITH positive_codes (survey_id, code) AS (VALUES ${pairValues})
    SELECT ct.survey_id, count(*)::int AS count
      FROM contact_targets ct
     WHERE ct.is_test = ${isTest}
       AND EXISTS (SELECT 1
                     FROM contact_attempts ca
                     JOIN positive_codes pc
                       ON pc.survey_id = ct.survey_id AND pc.code = ca.result_code
                    WHERE ca.contact_target_id = ct.id)
       AND NOT EXISTS (SELECT 1
                         FROM survey_responses sr
                        WHERE sr.contact_target_id = ct.id
                          AND sr.is_completed = true
                          AND sr.deleted_at IS NULL
                          AND sr.is_test = ${isTest})
     GROUP BY ct.survey_id
  `);

  for (const r of rows) result.set(r.survey_id, Number(r.count));
  return result;
}

/**
 * 한 설문 안에서 「이 조사 대상이 실사 완료 처리인가」 SQL 술어 — `getFieldworkCompletedCounts` 와 같은 정의.
 * 응답 상태 집계(`aggregateStatus`)가 실사 완료 처리된 사람의 이탈·불량·쿼터마감 행을 가려내는 데 쓴다.
 * 완료 코드가 없는 설문이면 FALSE.
 */
export function isFieldworkCompletedSql(
  contactTargetIdExpr: SQL,
  positiveCodes: readonly string[],
  isTest: boolean,
): SQL {
  if (positiveCodes.length === 0) return sql`FALSE`;
  // sql.join — 길이 1 배열이 스칼라로 풀려 ANY 가 22P02 를 내는 drizzle 함정 회피
  const codeList = sql.join(
    positiveCodes.map((c) => sql`${c}`),
    sql`, `,
  );
  return sql`(
    EXISTS (SELECT 1 FROM contact_attempts ca
             WHERE ca.contact_target_id = ${contactTargetIdExpr}
               AND ca.result_code IN (${codeList}))
    AND NOT EXISTS (SELECT 1 FROM survey_responses fw_sr
                     WHERE fw_sr.contact_target_id = ${contactTargetIdExpr}
                       AND fw_sr.is_completed = true
                       AND fw_sr.deleted_at IS NULL
                       AND fw_sr.is_test = ${isTest})
  )`;
}

/** 설문별 완료(positive) 결과코드를 (설문 id, 코드) 쌍으로 편다. 저장 전 설문은 기본 코드셋을 따른다. */
export function positiveCodePairs(
  rows: readonly { id: string; codes: ContactResultCode[] | null }[],
): [string, string][] {
  return rows.flatMap((row) =>
    extractResultCodeStatuses(row.codes).positive.map((code): [string, string] => [row.id, code]),
  );
}
