import { type SQL, inArray, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { decryptAnswerValue, isEncryptedAnswerValue } from '@/lib/crypto/response-pii';
import { OPT_TEXTS_KEY, readOptTextsSidecar } from '@/lib/option-text-read';
import { type AnswerChoiceMap, formatChoiceAnswer } from '@/lib/operations/profile-answer-choices';
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
 * 보기 열(`choices` 에 있는 열)은 저장값 대신 보기 글자를 보인다 — 문항 수준 보기의 상세 기재는
 * 응답 루트 `__optTexts__` 에서 읽어 괄호로 붙인다.
 *
 * `onEncryptedValue` 는 **저장값이 암호문이던 칸**마다 부른다(복호화 전 판정). 값을 밖으로 내보내는
 * 쪽(게스트가 받는 목록 엑셀)이 지금 구조의 개인정보 표시와 무관하게 그 칸을 가리는 근거다 — 표시를
 * 나중에 끈 문항도 저장값은 암호문으로 남아 있고 여기서 풀린다.
 */
export async function loadProfileAnswerValues(
  responseIds: readonly string[],
  columnKeys: readonly string[],
  choices: AnswerChoiceMap = new Map(),
  onEncryptedValue?: (responseId: string, columnKey: string) => void,
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
  const needsOptTexts = columns.some((c) => c.cellId === null && choices.has(c.key));
  if (needsOptTexts) fields['opt'] = sql<unknown>`${surveyResponses.questionResponses} -> ${OPT_TEXTS_KEY}`;

  const rows = await db
    .select({ id: surveyResponses.id, ...fields })
    .from(surveyResponses)
    .where(inArray(surveyResponses.id, [...responseIds]));

  const out: Record<string, Record<string, string>> = {};
  for (const row of rows as Array<Record<string, unknown> & { id: string }>) {
    const values: Record<string, string> = {};
    const optTexts = needsOptTexts ? readOptTextsSidecar({ [OPT_TEXTS_KEY]: row['opt'] }) : {};
    for (const col of columns) {
      const stored = row[`q${questionIds.indexOf(col.questionId)}`];
      if (onEncryptedValue) {
        const storedCell =
          col.cellId === null
            ? stored
            : typeof stored === 'object' && stored !== null && !Array.isArray(stored)
              ? (stored as Record<string, unknown>)[col.cellId]
              : undefined;
        if (isEncryptedAnswerValue(storedCell)) onEncryptedValue(row.id, col.key);
      }
      const raw = decryptAnswerValue(stored, {
        responseId: row.id,
        questionId: col.questionId,
      });
      const value =
        col.cellId === null
          ? raw
          : typeof raw === 'object' && raw !== null && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)[col.cellId]
            : undefined;
      const colChoices = choices.get(col.key);
      const text = colChoices
        ? formatChoiceAnswer(value, colChoices, col.cellId === null ? optTexts[col.questionId] : undefined)
        : formatProfileAnswerValue(value);
      if (text !== '') values[col.key] = text;
    }
    out[row.id] = values;
  }
  return out;
}
