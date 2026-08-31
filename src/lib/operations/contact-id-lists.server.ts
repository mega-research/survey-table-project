import { and, eq, inArray } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactIdLists } from '@/db/schema';

import { parseIdListToken } from './filter-shared';

/**
 * URL q 값들에서 `list:<uuid>` 토큰만 골라 저장된 ID 목록을 읽는다 — parseClausesFromUrl 의
 * extra.idLists 재료. 파서가 동기라 페이지/서비스가 파싱 전에 한 번 호출한다.
 * survey_id 로 걸러 타 설문 토큰은 모르는 토큰(0건)으로 접힌다.
 */
export async function loadIdListsForValues(
  surveyId: string,
  values: string[] | string | undefined,
): Promise<Map<string, number[]>> {
  const arr = values === undefined ? [] : Array.isArray(values) ? values : [values];
  const tokenIds = [
    ...new Set(
      arr.map((v) => parseIdListToken(v)?.id).filter((id): id is string => id !== undefined),
    ),
  ];
  const map = new Map<string, number[]>();
  if (tokenIds.length === 0) return map;
  const rows = await db
    .select({ id: contactIdLists.id, ids: contactIdLists.ids })
    .from(contactIdLists)
    .where(and(eq(contactIdLists.surveyId, surveyId), inArray(contactIdLists.id, tokenIds)));
  for (const r of rows) map.set(r.id, r.ids);
  return map;
}
