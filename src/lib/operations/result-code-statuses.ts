/**
 * 결과코드 status enum 처리 헬퍼.
 *
 * `surveys.contact_result_codes` JSONB 의 status 필드를 응답률·차단 SQL 의
 * positive/negative 코드 배열로 정규화. backward compat fallback 포함:
 * - status 명시 → 그대로 사용
 * - status 누락 + code === '1.조사완료' → positive
 * - 그 외 status 누락 → neutral (배열에 안 들어감)
 *
 * 사용자가 빌더에서 한 번 저장하면 명시 status 박혀 fallback 우회.
 */

import { cache } from 'react';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import { DEFAULT_RESULT_CODES, type ContactResultCode } from '@/db/schema/schema-types';

export interface ResultCodeStatuses {
  positive: string[];
  negative: string[];
}

/** pure — 단위 테스트 가능. `getResultCodeStatuses` 가 DB 조회 후 호출. */
export function extractResultCodeStatuses(
  codes: ContactResultCode[] | null,
): ResultCodeStatuses {
  const list = codes ?? DEFAULT_RESULT_CODES;
  const positive: string[] = [];
  const negative: string[] = [];
  for (const c of list) {
    const status = c.status ?? (c.code === '1.조사완료' ? 'positive' : 'neutral');
    if (status === 'positive') positive.push(c.code);
    else if (status === 'negative') negative.push(c.code);
  }
  return { positive, negative };
}

/**
 * `surveys.contact_result_codes` 조회 → extractResultCodeStatuses 적용.
 * `cache()` 로 RSC pass dedupe — 같은 surveyId 다중 호출 1회 query.
 */
export const getResultCodeStatuses = cache(
  async (surveyId: string): Promise<ResultCodeStatuses> => {
    const rows = await db
      .select({ contactResultCodes: surveys.contactResultCodes })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1);
    return extractResultCodeStatuses(rows[0]?.contactResultCodes ?? null);
  },
);
