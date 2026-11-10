import { and, asc, eq } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core';
import type { SelectResultFields } from 'drizzle-orm/query-builders/select.types';
import 'server-only';

import { db } from '@/db';
import { surveyAccessLinks } from '@/db/schema';
import { type AccessLinkKind, fieldworkLinkName } from '@/shared/contracts/workspace';

/**
 * 이 설문의 그 종류 링크 **전부**(종료 포함)를 발급 순(`created_at`, `id`)으로 — 발급 순번(「링크 N」)의 정본 쿼리.
 *
 * 순번은 종료된 링크까지 센다: 하나를 종료해도 남은 링크의 이름이 바뀌지 않아야 지난 기록의 「외주 · 링크 2」가
 * 같은 링크를 가리킨다. 그래서 순번은 이 결과의 **자리(index + 1)** 이고, 열린 것만 보이는 쪽은 센 뒤에 거른다.
 * 공유 설정 목록(`workspace/services/access-links` 의 `listAccessLinks`)과 아래 내부 기록 이름이 이 함수 하나를
 * 지나 두 화면의 「링크 2」가 같은 링크다.
 */
export async function selectAccessLinksInIssueOrder<T extends SelectedFields>(
  fields: T,
  surveyId: string,
  kind: AccessLinkKind,
): Promise<SelectResultFields<T>[]> {
  // 칸 묶음이 제네릭이라 drizzle 추론이 넓어진다 — 결과 모양은 넘긴 칸 그대로다.
  return (await db
    .select(fields)
    .from(surveyAccessLinks)
    .where(and(eq(surveyAccessLinks.surveyId, surveyId), eq(surveyAccessLinks.kind, kind)))
    .orderBy(
      asc(surveyAccessLinks.createdAt),
      asc(surveyAccessLinks.id),
    )) as SelectResultFields<T>[];
}

/** 링크 id → 내부 화면이 부르는 링크 이름(이름표 또는 「링크 N」). */
export type FieldworkLinkNames = ReadonlyMap<string, string>;

/**
 * 이 설문의 외주 링크 이름 — 내부 기록의 「외주 · <이름>」 재료 (fieldwork-multi-company 티켓 02).
 *
 * **종료된 링크도 담는다** — 기록은 링크가 닫혀도 남고, 그 줄도 어느 링크가 남겼는지 보여야 한다.
 * 순번은 `selectAccessLinksInIssueOrder` 의 자리다(공유 설정 목록과 같은 쿼리). 이름표는 **지금** 값이라
 * 고치면 지난 줄도 새 이름으로 보인다.
 *
 * **내부 콘솔 전용이다.** 외주 콘솔의 조립은 이 함수를 부르지 않는다 — 이름표는 연구원의 메모라
 * 링크 세션이 여는 어떤 응답 모양에도 실리지 않는다(`app/_operations/contact-detail-screen`).
 */
export async function loadFieldworkLinkNames(surveyId: string): Promise<FieldworkLinkNames> {
  const rows = await selectAccessLinksInIssueOrder(
    { id: surveyAccessLinks.id, label: surveyAccessLinks.label },
    surveyId,
    'fieldwork',
  );
  return new Map(
    rows.map((row, index) => [row.id, fieldworkLinkName({ label: row.label, ordinal: index + 1 })]),
  );
}
