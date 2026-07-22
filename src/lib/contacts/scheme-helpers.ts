import { eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveys } from '@/db/schema';
import type { ContactColumnScheme } from '@/db/schema/schema-types';
import { piiKeyOf } from '@/lib/operations/contacts';

/**
 * surveys.contactColumns 에서 PII 로 마킹된 컬럼의 column_key set 을 추출.
 * 스킴이 없거나 PII 컬럼이 없으면 빈 set 반환.
 */
function collectPiiKeys(scheme: ContactColumnScheme | null): Set<string> {
  const keys = new Set<string>();
  if (!scheme) return keys;
  for (const c of scheme.columns) {
    if (!c.piiType) continue;
    const k = piiKeyOf(c.source);
    if (k) keys.add(k);
  }
  return keys;
}

/** DB 조회 없이 이미 잠금 아래 확정된 컬럼 스킴으로 attrs의 PII 평문을 제거한다. */
export function sanitizeAttrsAgainstPiiScheme(
  attrs: Record<string, string>,
  scheme: ContactColumnScheme | null,
): Record<string, string> {
  const piiKeys = collectPiiKeys(scheme);
  if (piiKeys.size === 0) return attrs;
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!piiKeys.has(key)) clean[key] = value;
  }
  return clean;
}

/**
 * 컬럼 스킴에 PII 로 마킹된 컬럼 key 를 attrs 에서 제거.
 * UI 우회 (직접 API 호출) 시 PII 가 attrs JSONB 에 평문 누적되는 것을 차단하는 방어 레이어.
 *
 * 호출 비용: surveys 조회 1회. addContactTarget / updateContactTarget 진입점에서 사용.
 */
export async function sanitizeAttrsAgainstPii(
  surveyId: string,
  attrs: Record<string, string>,
): Promise<Record<string, string>> {
  const [row] = await db
    .select({ contactColumns: surveys.contactColumns })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  const scheme = (row?.contactColumns as ContactColumnScheme | null) ?? null;
  return sanitizeAttrsAgainstPiiScheme(attrs, scheme);
}
