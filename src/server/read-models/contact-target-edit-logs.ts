import { and, desc, eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargetEditLogs, contactTargets } from '@/db/schema';
import { type OperationsDataScope, targetScopeCondition } from '@/server/data-scope';
import type { ContactTargetEditChange } from '@/shared/contracts/contacts';
import type { ContactTargetEditLogRow } from '@/shared/contracts/contacts-io';

/** 상세 화면이 한 번에 읽는 기록 상한. 대상당 기록은 사람이 손으로 고친 횟수라 작다. */
export const CONTACT_TARGET_EDIT_LOG_LIMIT = 200;

/**
 * 이 화면이 받을 변경만 남긴다 — 게스트는 컨택원(내부 실사 운영 정보) 변경을 받지 않는다.
 * 로더가 RSC props 에 싣기 전에 부른다(화면이 숨기는 것이 아니다).
 */
export function visibleContactTargetEditChanges(
  changes: ContactTargetEditChange[],
  viewer: { isGuest: boolean },
): ContactTargetEditChange[] {
  if (!viewer.isGuest) return changes;
  return changes.filter((c) => c.kind !== 'assignment');
}

/**
 * 「대상 정보 수정 현황」 — 조사 대상 한 명의 기록을 최신순으로 최대 200줄.
 *
 * 대상이 지금 운영 데이터 스코프(실/테스트)에 속할 때만 낸다 — 테스트 파티션 대상의 기록은
 * 테스트 데이터를 보는 콘솔에서만 보인다. 게스트 화면이면 컨택원 변경을 빼고, 그것만 담긴 줄은
 * 줄째 뺀다 — RSC props 에 싣지 않는다(화면이 숨기는 것이 아니다).
 */
export async function getContactTargetEditLogs(
  contactTargetId: string,
  scope: OperationsDataScope,
  viewer: { isGuest: boolean },
): Promise<ContactTargetEditLogRow[]> {
  const rows = await db
    .select({
      id: contactTargetEditLogs.id,
      action: contactTargetEditLogs.action,
      editorEmail: contactTargetEditLogs.editorEmail,
      changes: contactTargetEditLogs.changes,
      createdAt: contactTargetEditLogs.createdAt,
    })
    .from(contactTargetEditLogs)
    .innerJoin(contactTargets, eq(contactTargetEditLogs.contactTargetId, contactTargets.id))
    .where(
      and(eq(contactTargetEditLogs.contactTargetId, contactTargetId), targetScopeCondition(scope)),
    )
    .orderBy(desc(contactTargetEditLogs.createdAt), desc(contactTargetEditLogs.id))
    .limit(CONTACT_TARGET_EDIT_LOG_LIMIT);

  const visible: ContactTargetEditLogRow[] = [];
  for (const row of rows) {
    const changes = visibleContactTargetEditChanges(row.changes, viewer);
    if (changes.length === 0) continue;
    visible.push({ ...row, changes });
  }
  return visible;
}
