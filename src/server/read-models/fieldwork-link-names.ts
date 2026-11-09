import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyAccessLinks } from '@/db/schema';
import { fieldworkLinkName } from '@/shared/contracts/workspace';

/** 링크 id → 내부 화면이 부르는 링크 이름(이름표 또는 「링크 N」). */
export type FieldworkLinkNames = ReadonlyMap<string, string>;

/**
 * 이 설문의 외주 링크 이름 — 내부 기록의 「외주 · <이름>」 재료 (fieldwork-multi-company 티켓 02).
 *
 * **종료된 링크도 담는다** — 기록은 링크가 닫혀도 남고, 그 줄도 어느 링크가 남겼는지 보여야 한다.
 * 순번은 공유 설정 목록(`listAccessLinks`)과 같은 정렬(`created_at`, `id`)로 센다 — 두 화면의
 * 「링크 2」가 같은 링크여야 한다. 이름표는 **지금** 값이라 고치면 지난 줄도 새 이름으로 보인다.
 *
 * **내부 콘솔 전용이다.** 외주 콘솔의 조립은 이 함수를 부르지 않는다 — 이름표는 연구원의 메모라
 * 링크 세션이 여는 어떤 응답 모양에도 실리지 않는다(`app/_operations/contact-detail-screen`).
 */
export async function loadFieldworkLinkNames(surveyId: string): Promise<FieldworkLinkNames> {
  const rows = await db
    .select({ id: surveyAccessLinks.id, label: surveyAccessLinks.label })
    .from(surveyAccessLinks)
    .where(and(eq(surveyAccessLinks.surveyId, surveyId), eq(surveyAccessLinks.kind, 'fieldwork')))
    .orderBy(asc(surveyAccessLinks.createdAt), asc(surveyAccessLinks.id));
  return new Map(rows.map((row, index) => [row.id, fieldworkLinkName({ label: row.label, ordinal: index + 1 })]));
}
