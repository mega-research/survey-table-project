import { and, asc, eq } from 'drizzle-orm';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { contactAssignments } from '@/db/schema';
import { testFlagForScope, type OperationsDataScope } from '@/server/data-scope';
import type { ContactAssignmentOption } from '@/shared/contracts/contacts-io';

/**
 * 이 설문·파티션의 컨택원 — 순서대로(같으면 이름순). 필터 선택지·진척 보고 줄 순서·관리 화면이
 * 같은 순서를 쓴다. 조사 대상 필터 해석(contact-filter-resolution)도 이것으로 「현재 컨택원」
 * 절을 검증하므로 읽기 projection 에 둔다.
 */
export async function listAssignmentOptions(
  surveyId: string,
  scope: OperationsDataScope,
  executor: DbOrTx = db,
): Promise<ContactAssignmentOption[]> {
  return executor
    .select({
      id: contactAssignments.id,
      name: contactAssignments.name,
      order: contactAssignments.order,
    })
    .from(contactAssignments)
    .where(
      and(
        eq(contactAssignments.surveyId, surveyId),
        eq(contactAssignments.isTest, testFlagForScope(scope)),
      ),
    )
    .orderBy(asc(contactAssignments.order), asc(contactAssignments.name));
}
