import type { Question, QuestionConditionGroup } from '@/types/survey';

export const SPLIT_SOFT_LIMIT = 10000;
export const SPLIT_EXCEL_LIMIT = 16384;


/** displayCondition 중 basisId를 value-match 하는 조건의 requiredValues 합집합. 없으면 null. */
export function valueMatchSet(
  dc: QuestionConditionGroup | undefined,
  basisId: string,
): Set<string> | null {
  if (!dc || !Array.isArray(dc.conditions)) return null;
  let s: Set<string> | null = null;
  for (const c of dc.conditions) {
    if (
      c.conditionType === 'value-match' &&
      c.sourceQuestionId === basisId &&
      Array.isArray(c.requiredValues) &&
      c.requiredValues.length > 0
    ) {
      s = s ?? new Set<string>();
      for (const v of c.requiredValues) s.add(v);
    }
  }
  return s;
}

/** bucket('common' | 옵션토큰)에 속한 질문/행만 남긴 복사본 리스트 */
export function bucketQuestions(
  questions: Question[],
  basisId: string,
  bucket: string,
): Question[] {
  const out: Question[] = [];
  for (const q of questions) {
    const qset = valueMatchSet(q.displayCondition, basisId);
    if (bucket === 'common') {
      if (qset !== null) continue; // 옵션 전용 질문
      if (q.type === 'table' && Array.isArray(q.tableRowsData)) {
        const rows = q.tableRowsData.filter((r) => valueMatchSet(r.displayCondition, basisId) === null);
        if (rows.length === 0) continue;
        out.push({ ...q, tableRowsData: rows });
      } else {
        out.push(q);
      }
    } else {
      if (qset !== null && !qset.has(bucket)) continue; // 다른 옵션 전용
      if (qset !== null) {
        out.push(q); // 이 옵션 전용 질문 → 전체 행
      } else if (q.type === 'table' && Array.isArray(q.tableRowsData)) {
        const rows = q.tableRowsData.filter((r) => {
          const rs = valueMatchSet(r.displayCondition, basisId);
          return rs !== null && rs.has(bucket);
        });
        if (rows.length === 0) continue;
        out.push({ ...q, tableRowsData: rows });
      }
      // 공통 비테이블 질문은 옵션 시트에 넣지 않음(공통 시트로 감)
    }
  }
  return out;
}
