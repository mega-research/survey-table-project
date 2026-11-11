import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema';
import { isResultCodeRowMark } from '@/lib/contacts/result-code-row-mark';
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
  // 목록 행 표시 가드 — 입력 스키마가 z.custom 이라 런타임 검증이 없다. 모르는 값은 저장 전에 거부한다.
  if (codes?.some((c) => c.rowMark !== undefined && !isResultCodeRowMark(c.rowMark))) {
    throw new Error('목록 행 표시 값이 올바르지 않습니다.');
  }

  await db
    .update(surveys)
    .set({ contactResultCodes: codes })
    .where(eq(surveys.id, surveyId));
}
