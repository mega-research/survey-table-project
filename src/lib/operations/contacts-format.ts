/**
 * 운영 콘솔 컨택리스트 페이지의 표시용 pure helper + 클라/서버 공용 타입.
 *
 * 'server-only' marker 는 server/read-models/contacts.ts 에만 둔다. 본 모듈은 DB/server-only
 * 의존을 일체 갖지 않아 client component 가 import 해도 안전하다.
 *
 * 단위 테스트: tests/unit/domains/operations/contacts.test.ts.
 */

import type { ContactColumnScheme } from '@/shared/contracts/contacts';

/**
 * system.resid 컬럼의 기본 표시 라벨.
 * 고객 엑셀의 NO/ID 류 컬럼과 구분하기 위해 '번호' 대신 '시스템ID' 사용
 * (기존 설문 스킴은 0073 수동 마이그레이션으로 일괄 갱신, 커스텀 라벨은 보존).
 */
export const RESID_DEFAULT_LABEL = '시스템ID';

/**
 * contact_columns / test_contact_columns JSONB 드리프트 방어.
 *
 * 이 컬럼은 `.$type<ContactColumnScheme>()` 로 선언돼 있어 타입 시스템은 `columns` 가
 * 항상 배열이라고 믿지만, JSONB 는 그 계약을 강제하지 않는다. 실제로 `columns` 키가 없는
 * 객체가 저장돼 있어 `scheme?.columns.find(...)` 가 런타임에 터졌다 — 옵셔널 체이닝이
 * `scheme` 만 막고 `columns` 는 막지 못한다.
 *
 * 호출부마다 `?.` 를 덧대는 대신 로더 한 곳에서 형태를 보정한다. columns 가 배열이 아니면
 * 빈 배열로 낮추되 나머지 필드(version/headerRow 등)는 보존한다 — 스킴 전체를 null 로
 * 버리면 컬럼 설정이 통째로 사라진 것처럼 보인다.
 */
declare const NORMALIZED_SCHEME: unique symbol;

/**
 * 정규화를 거친 컬럼 스킴 — `columns` 가 배열임이 보장된다.
 *
 * `normalizeContactColumnScheme` 만 이 타입을 만들 수 있다. 스킴의 `columns` 를 무보호로
 * 읽는 소비 함수는 이 타입을 받게 해서, DB JSONB 를 그대로 캐스팅해 넘기는 호출부가
 * 런타임이 아니라 컴파일에서 걸리게 한다.
 *
 * 브랜드는 타입 전용이라(런타임 프로퍼티 없음) 직렬화·RSC 경계 통과에 영향이 없고,
 * `ContactColumnScheme` 로는 그대로 대입되므로 편집기 등 기존 소비처는 손대지 않아도 된다.
 */
export type NormalizedContactColumnScheme = ContactColumnScheme & {
  readonly [NORMALIZED_SCHEME]: true;
};

export function normalizeContactColumnScheme(
  raw: unknown,
): NormalizedContactColumnScheme | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const scheme = raw as ContactColumnScheme;
  // 브랜드는 런타임에 존재하지 않는 표식이므로 이 한 곳에서만 단언한다.
  if (Array.isArray(scheme.columns)) return scheme as NormalizedContactColumnScheme;
  return { ...scheme, columns: [] } as unknown as NormalizedContactColumnScheme;
}

/**
 * 사전 정의된 시스템 정렬 키. attrs.* 정렬은 별도로 `attrs.<key>` 형태로 받음
 * (`isAttrsSortKey` / `attrsSortKey` helper).
 */
export const CONTACTS_SORT_KEYS = [
  'resid',
  'respondedAt',
  'createdAt',
  'group',
  // web 컬럼 헤더 정렬 — 매칭 응답의 활동 시각(완료면 완료 시각, 미완료면 마지막
  // 활동 시각) 기준. respondedAt 정렬은 미완료(진행중·이탈) 행이 전부 NULL 이라
  // 순서가 생기지 않는다. 상태별 골라보기는 정렬이 아니라 web 필터 소관.
  'webActivity',
  // 메일 컬럼 헤더 정렬 — 최신 수신 상태 순위(열람 → 전달 완료 → … → 실패),
  // 발송 이력 없음은 항상 마지막.
  'mailStatus',
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
