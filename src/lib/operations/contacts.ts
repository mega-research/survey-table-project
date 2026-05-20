/**
 * 운영 콘솔 컨택리스트 페이지의 표시용 pure helper + 클라/서버 공용 타입.
 *
 * 'server-only' marker 는 contacts.server.ts 에만 둔다. 본 모듈은 DB/server-only
 * 의존을 일체 갖지 않아 client component 가 import 해도 안전하다.
 *
 * 단위 테스트: tests/unit/domains/operations/contacts.test.ts.
 */

/**
 * 사전 정의된 시스템 정렬 키. attrs.* 정렬은 별도로 `attrs.<key>` 형태로 받음
 * (`isAttrsSortKey` / `attrsSortKey` helper).
 */
export const CONTACTS_SORT_KEYS = [
  'resid',
  'respondedAt',
  'createdAt',
  'group',
] as const;
export type ContactsSystemSortKey = (typeof CONTACTS_SORT_KEYS)[number];

/** 시스템 키 또는 'attrs.<header>' 형식. */
export type ContactsSortKey = ContactsSystemSortKey | `attrs.${string}`;

export type ContactsSortDir = 'asc' | 'desc';

export function isAttrsSortKey(sort: string): sort is `attrs.${string}` {
  return sort.startsWith('attrs.');
}

/** 'attrs.<key>' → '<key>'. attrs 가 아니면 null. */
export function attrsSortKey(sort: string): string | null {
  return isAttrsSortKey(sort) ? sort.slice('attrs.'.length) : null;
}

/**
 * 컬럼 스킴에서 hidden 컬럼을 sort key 로 받았을 때 'resid' 로 폴백.
 * 사용자가 URL 직접 조작으로 보이지 않는 컬럼 정렬 상태가 되는 것을 막음.
 */
export function effectiveSortKey(
  sort: ContactsSortKey,
  visibleAttrsKeys: ReadonlySet<string>,
): ContactsSortKey {
  const ak = attrsSortKey(sort);
  if (ak == null) return sort; // system key 는 그대로
  return visibleAttrsKeys.has(ak) ? sort : 'resid';
}

export const CONTACTS_QFIELDS = ['all', 'resid', 'email', 'group', 'biz'] as const;
export type ContactsQField = (typeof CONTACTS_QFIELDS)[number];

/** 결과코드 enum 은 후속 슬라이스에서 정의. 본 슬라이스는 자유 텍스트. */
export type ContactsResultCodeFilter = 'all' | string;

export const CONTACTS_PAGE_SIZE = 20;

export interface NormalizedContactListArgs {
  page: number;
  q: string;
  qfield: ContactsQField;
  resultCode: ContactsResultCodeFilter;
  sort: ContactsSortKey;
  dir: ContactsSortDir;
}

function pickFromWhitelist<T extends string>(
  value: string | undefined,
  whitelist: readonly T[],
  fallback: T,
): T {
  return (whitelist as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

/**
 * sort 파라미터 normalize — 시스템 키 화이트리스트 OR 'attrs.<key>' 형식.
 * attrs 키는 길이 200 이내 + DB 안전성은 server adapter 가 책임 (drizzle SQL placeholder).
 */
export function normalizeSortKey(value: string | undefined): ContactsSortKey {
  if (!value) return 'resid';
  if (isAttrsSortKey(value) && value.length <= 200) return value;
  return (CONTACTS_SORT_KEYS as readonly string[]).includes(value) ? (value as ContactsSortKey) : 'resid';
}

// normalizeContactListArgs / hasActiveContactFilters 는 qfield/q/resultCode 기반 단일 필터
// 모델 전용이라 다중 조건(col[]/q[]/op[]) 전환과 함께 제거됨. page.tsx 가 인라인으로 page/sort/dir
// 파싱하고 활성 여부는 `clauses.length > 0` 로 판정한다.

// ─────────── 마스킹 (PII) ───────────

const DASH = '—';

export function maskEmail(value: string | null | undefined): string {
  if (!value) return DASH;
  const at = value.indexOf('@');
  if (at <= 0) return DASH;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  const localShown = local.slice(0, Math.min(2, local.length));
  return `${localShown}***@***${tld}`;
}

export function maskPhone(value: string | null | undefined): string {
  if (!value) return DASH;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return DASH;
  const tail = digits.slice(-4);
  if (digits.length === 11 && digits.startsWith('010')) {
    return `010-****-${tail}`;
  }
  if (digits.length >= 10) {
    const head = digits.slice(0, 3);
    return `${head}-****-${tail}`;
  }
  return `****-${tail}`;
}

export function maskBizNumber(value: string | null | undefined): string {
  if (!value) return DASH;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return DASH;
  const head = digits.slice(0, 3);
  const tail4 = digits.slice(-4);
  return `${head}-**-*${tail4}`;
}

// ─────────── attrs 표시 helper ───────────

/**
 * ContactColumnDef.source 에서 attrs key 추출. 'attrs.전시회명' → '전시회명'.
 * system.* / pii.* 는 null 반환.
 */
export function attrsKeyOf(source: string): string | null {
  if (source.startsWith('attrs.')) return source.slice('attrs.'.length);
  return null;
}

/**
 * ContactColumnDef.source 에서 PII column_key 추출. 'pii.담당자이메일' → '담당자이메일'.
 * 그 외는 null 반환.
 */
export function piiKeyOf(source: string): string | null {
  if (source.startsWith('pii.')) return source.slice('pii.'.length);
  return null;
}
