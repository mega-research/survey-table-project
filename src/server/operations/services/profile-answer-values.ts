import { type SQL, inArray, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { decryptAnswerValue } from '@/lib/crypto/response-pii';
import { answerKeyOf } from '@/lib/operations/profile-columns-format';

/**
 * 응답값 하나를 목록 칸 글자로 — 문자열·숫자는 그대로, 배열은 쉼표로 잇고, 그 밖의 모양
 * (선택형 표 응답 객체 등)은 응답값 열 대상이 아니라 비운다.
 */
export function formatProfileAnswerValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .map(String)
      .join(', ');
  }
  return '';
}

/**
 * 응답 내역 한 쪽 행들의 응답값 열 값 — 응답 id → 열 키 → 표시 글자.
 *
 * 쪽에 보이는 행만, 열이 가리키는 문항만 JSONB 에서 꺼낸다(응답 전체를 읽지 않는다).
 * 개인정보로 암호화 저장한 문항·칸은 복호화해 보여 준다 — 명단 개인정보 열과 같은 규칙이고,
 * 복호화 판단은 질문 메타데이터 없이 값의 접두사로 한다(ADR-0012).
 */
export async function loadProfileAnswerValues(
  responseIds: readonly string[],
  columnKeys: readonly string[],
): Promise<Record<string, Record<string, string>>> {
  const columns = columnKeys.flatMap((key) => {
    const ref = answerKeyOf(key);
    return ref ? [{ key, ...ref }] : [];
  });
  if (responseIds.length === 0 || columns.length === 0) return {};

  const questionIds = [...new Set(columns.map((c) => c.questionId))];
  const fields: Record<string, SQL<unknown>> = {};
  questionIds.forEach((qid, i) => {
    fields[`q${i}`] = sql<unknown>`${surveyResponses.questionResponses} -> ${qid}`;
  });

  const rows = await db
    .select({ id: surveyResponses.id, ...fields })
    .from(surveyResponses)
    .where(inArray(surveyResponses.id, [...responseIds]));

  const out: Record<string, Record<string, string>> = {};
  for (const row of rows as Array<Record<string, unknown> & { id: string }>) {
    const values: Record<string, string> = {};
    for (const col of columns) {
      const raw = decryptAnswerValue(row[`q${questionIds.indexOf(col.questionId)}`], {
        responseId: row.id,
        questionId: col.questionId,
      });
      const value =
        col.cellId === null
          ? raw
          : typeof raw === 'object' && raw !== null && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)[col.cellId]
            : undefined;
      const text = formatProfileAnswerValue(value);
      if (text !== '') values[col.key] = text;
    }
    out[row.id] = values;
  }
  return out;
}
