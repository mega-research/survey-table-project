import { sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { loadFieldworkLinkNames } from '@/server/read-models/fieldwork-link-names';
import type { FieldworkShareReleaseRow } from '@/shared/contracts/contacts-io';

/**
 * 명단 교체 업로드가 풀 담당 범위 — 링크별 인원 (fieldwork-multi-company 티켓 09, ADR-0035).
 *
 * 교체 업로드는 실데이터 조사 대상을 지우고 새로 만든다. 담당 범위 표의 대상 FK 가 CASCADE 라 범위가
 * 전부 풀리고, 「나눈 적 있음」은 링크 칸이라 그대로 남아 **나눈 링크는 다시 나눌 때까지 0명**을 본다
 * (넓어지지 않는다). 업로드 화면이 그 사실을 미리 보이도록 「풀릴 담당 범위: 프롬 N명 · 프라임 M명」의
 * 재료를 낸다.
 *
 * - **열린 외주 링크만, 범위가 1명 이상인 링크만**. 나누지 않은 링크는 새 명단 전체를 보게 되므로 풀릴
 *   것이 없고, 종료된 링크는 종료가 이미 범위를 풀었다. 발급 순(`created_at`, `id`).
 * - **실데이터 대상만** 센다 — 범위는 실데이터에만 서고, 교체 업로드도 실데이터만 지운다.
 * - 이름은 내부 화면 이름(이름표 또는 「링크 N」)이다 — 업로드 화면은 내부 콘솔(`contacts.manage`)이라
 *   실려도 된다. 외주 콘솔은 이 함수를 부르지 않는다.
 */
export async function countFieldworkSharesToRelease(
  surveyId: string,
): Promise<FieldworkShareReleaseRow[]> {
  const [rows, names] = await Promise.all([
    db.execute(sql`
      SELECT l.id AS link_id, count(*)::int AS n
      FROM survey_access_links l
      JOIN fieldwork_link_shares s ON s.link_id = l.id
      JOIN contact_targets t ON t.id = s.contact_target_id
      WHERE l.survey_id = ${surveyId}
        AND l.kind = 'fieldwork'
        AND l.closed_at IS NULL
        AND t.survey_id = ${surveyId}
        AND t.is_test = FALSE
      GROUP BY l.id, l.created_at
      ORDER BY l.created_at, l.id
    `),
    loadFieldworkLinkNames(surveyId),
  ]);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => {
    const linkId = String(r['link_id']);
    return { linkId, name: names.get(linkId) ?? '', count: Number(r['n']) };
  });
}
