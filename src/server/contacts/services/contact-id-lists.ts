import 'server-only';

import { db } from '@/db';
import { contactIdLists } from '@/db/schema';
import { MAX_STORED_ID_LIST, isValidId } from '@/lib/operations/range-list';

/** 1 이상 정수만 남기고 중복 제거·오름차순 — 저장 형식 불변식 (조회 SQL 이 IN 으로 그대로 쓴다). */
function normalizeIds(ids: number[]): number[] {
  const clean = new Set<number>();
  for (const n of ids) {
    if (isValidId(n)) clean.add(n);
  }
  return [...clean].sort((a, b) => a - b);
}

/**
 * 붙여넣은 ID 목록 저장 — 인라인 상한(2,000)을 넘는 검색이 URL 대신 참조할 토큰의 실체.
 * 만료·정리 없음: 캠페인 filterSnapshot 이 토큰을 보존하므로 "미응답자 재발송" 재현에 필요하다.
 * 인증은 procedure(scoped + assertSurveyAccess)가 담당.
 */
export async function createContactIdList(input: {
  surveyId: string;
  ids: number[];
  createdBy: string | null;
}): Promise<{ id: string; count: number }> {
  const ids = normalizeIds(input.ids);
  if (ids.length === 0) throw new Error('저장할 ID 가 없습니다.');
  if (ids.length > MAX_STORED_ID_LIST) {
    throw new Error(
      `ID 목록은 한 번에 ${MAX_STORED_ID_LIST.toLocaleString('ko-KR')}개까지 저장할 수 있습니다.`,
    );
  }
  const [row] = await db
    .insert(contactIdLists)
    .values({ surveyId: input.surveyId, ids, idCount: ids.length, createdBy: input.createdBy })
    .returning({ id: contactIdLists.id });
  if (!row) throw new Error('ID 목록 저장에 실패했습니다.');
  return { id: row.id, count: ids.length };
}
