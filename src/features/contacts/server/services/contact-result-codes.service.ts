import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema';
import type { ContactResultCode } from '@/shared/contracts/contacts';

/**
 * 결과코드 set 갱신 — NULL 로 set 하면 DEFAULT_RESULT_CODES 폴백.
 * 빈 배열은 reject (최소 1개 필요).
 *
 * null 은 그대로 set 해야 함(coalesce 금지). null = 기본 코드셋 복귀 의미.
 * ContactResultCode[] JSONB 는 컬럼 $type 그대로 통과.
 */
export async function updateResultCodes(
  surveyId: string,
  codes: ContactResultCode[] | null,
): Promise<void> {
  if (codes && codes.length === 0) {
    throw new Error('결과코드는 최소 1개 이상이어야 합니다.');
  }

  await db
    .update(surveys)
    .set({ contactResultCodes: codes })
    .where(eq(surveys.id, surveyId));
}
