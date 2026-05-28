/**
 * 결과코드 status enum 처리 헬퍼 (pure).
 *
 * `surveys.contact_result_codes` JSONB 의 status 필드를 응답률·차단 SQL 의
 * positive/negative 코드 배열로 정규화. backward compat fallback 포함:
 * - status 명시 → 그대로 사용
 * - status 누락 + code === '1.조사완료' → positive
 * - 그 외 status 누락 → neutral (배열에 안 들어감)
 *
 * 사용자가 빌더에서 한 번 저장하면 명시 status 박혀 fallback 우회.
 *
 * 이 파일은 pure 함수만 노출 — DB 의존성 없음. client/server 양쪽에서 import 가능.
 * cache wrapped DB 호출은 `result-code-statuses.server.ts` 참조.
 */

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
