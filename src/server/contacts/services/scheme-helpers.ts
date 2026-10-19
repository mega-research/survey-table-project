import { eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveys } from '@/db/schema';
import type { ContactColumnDef, ContactColumnScheme, ContactUploadMapping } from '@/shared/contracts/contacts';
import { piiKeyOf } from '@/lib/operations/contacts-format';
import type { NormalizedContactColumnScheme } from '@/lib/operations/contacts-format';
import { normalizeContactColumnScheme } from '@/lib/operations/contacts-format';

export { getSchemeRouting, type SchemeRouting } from '@/lib/contacts/match-contacts';

/**
 * surveys.contactColumns 에서 PII 로 마킹된 컬럼의 column_key set 을 추출.
 * 스킴이 없거나 PII 컬럼이 없으면 빈 set 반환.
 */
function collectPiiKeys(scheme: NormalizedContactColumnScheme | null): Set<string> {
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
  scheme: NormalizedContactColumnScheme | null,
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
  const scheme = normalizeContactColumnScheme(row?.contactColumns ?? null);
  return sanitizeAttrsAgainstPiiScheme(attrs, scheme);
}

const OPERATION_COLUMN_SOURCES = new Set([
  'system.contact_result',
  'system.email_count',
  'system.web',
  'system.contact_owner',
]);

/**
 * 병합/추가 업로드용 스킴 갱신: 신규 헤더만 운영 컬럼 앞에 삽입.
 * 기존 컬럼의 라벨·숨김·순서는 보존하고 order 만 1부터 재부여한다.
 */
export function appendNewColumnsToScheme(
  scheme: NormalizedContactColumnScheme,
  headerKeys: string[],
  mapping: ContactUploadMapping,
): ContactColumnScheme {
  const existingKeys = new Set(scheme.columns.map((c) => c.key));
  const newKeys = headerKeys.filter((k) => !existingKeys.has(k));
  if (newKeys.length === 0) return scheme;

  const selected = new Set(mapping.selectedAttrsKeys);
  const piiMapping = mapping.piiMapping ?? {};
  const labelOverrides = mapping.labelOverrides ?? {};

  const newColumns: ContactColumnDef[] = newKeys.map((key) => {
    const piiType = piiMapping[key];
    const label = labelOverrides[key] ?? key;
    return piiType
      ? { key, label, source: `pii.${key}` as const, order: 0, hidden: !selected.has(key), piiType }
      : { key, label, source: `attrs.${key}` as const, order: 0, hidden: !selected.has(key) };
  });

  const head = scheme.columns.filter((c) => !OPERATION_COLUMN_SOURCES.has(c.source));
  const tail = scheme.columns.filter((c) => OPERATION_COLUMN_SOURCES.has(c.source));
  const columns = [...head, ...newColumns, ...tail].map((c, i) => ({ ...c, order: i + 1 }));

  return { ...scheme, columns };
}

/**
 * 「컨택원」 열(system.contact_owner)이 없는 스킴에 그 열을 끝(운영 열 자리)에 덧붙인다.
 * 이미 있으면 같은 객체를 그대로 돌려준다 — 호출부가 참조 비교로 저장 여부를 정한다.
 * 컨택원 기능 전에 만든 스킴은 이 열이 없을 수 있다(테스트 스킴·열 설정에서 지운 경우).
 */
export function ensureContactOwnerColumn<T extends ContactColumnScheme>(scheme: T): T {
  if (scheme.columns.some((c) => c.source === 'system.contact_owner')) return scheme;
  const order = scheme.columns.reduce((max, c) => Math.max(max, c.order), 0) + 1;
  return {
    ...scheme,
    columns: [
      ...scheme.columns,
      { key: 'contact_owner', label: '컨택원', source: 'system.contact_owner', order },
    ],
  };
}
