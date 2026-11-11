import type { ContactColumnDef, ContactColumnScheme } from '@/shared/contracts/contacts';
import {
  type ContactsSortKey,
  attrsKeyOf,
  effectiveSortKey,
  normalizeSortKey,
} from '@/lib/operations/contacts-format';

/**
 * 조사 대상 목록의 기본 정렬 열 — 주소에 정렬이 없을 때 이 열 오름차순으로 연다.
 *
 * 담당자가 올린 엑셀의 자체 ID 열(이름은 설문마다 다르다)을 컬럼 설정에서 한 열 지정한다.
 * 지정이 없으면 종전대로 시스템ID 순이다. 정렬 자체는 머리글 정렬과 같은 식을 쓴다
 * (`attrsNaturalSortExprs` — 글자로 올라온 숫자도 숫자순).
 * 서버(페이지·저장 가드·교체 업로드)와 클라이언트(컬럼 설정 스위치)가 공유하는 순수 모듈 — 'server-only' 금지.
 */

type SortableColumn = Pick<ContactColumnDef, 'source'>;

/** 기본 정렬을 걸 수 있는 열인가 — 명단 일반 열(attrs.*)만. 개인정보 열은 암호문이라 정렬이 없다. */
export function canBeDefaultSort(col: SortableColumn): boolean {
  return attrsKeyOf(col.source) !== null;
}

/** 스킴이 정한 기본 정렬 키. 지정이 없거나, 지정한 열이 숨김·일반 열이 아니면 시스템ID. */
export function resolveDefaultSortKey(
  scheme: Pick<ContactColumnScheme, 'columns'> | null | undefined,
): ContactsSortKey {
  const columns = scheme?.columns;
  if (!Array.isArray(columns)) return 'resid';
  const col = columns.find((c) => c.defaultSort === true && !c.hidden && canBeDefaultSort(c));
  const key = col ? attrsKeyOf(col.source) : null;
  return key !== null ? `attrs.${key}` : 'resid';
}

/**
 * 목록 주소의 `sort` 값 → 실제 정렬 키.
 * 주소에 정렬이 있으면 그것이 이긴다(숨긴 열·모르는 키는 시스템ID 로 떨어지는 종전 가드 그대로).
 * 없을 때만 스킴의 기본 정렬 열을 쓴다 — 머리글을 눌러 시스템ID 순으로 되돌릴 수 있어야 하기 때문이다.
 */
export function resolveContactListSort(
  requested: string | undefined,
  scheme: Pick<ContactColumnScheme, 'columns'> | null | undefined,
): ContactsSortKey {
  if (!requested) return resolveDefaultSortKey(scheme);
  const columns = Array.isArray(scheme?.columns) ? scheme.columns : [];
  const visibleAttrsKeys = new Set(
    columns
      .filter((c) => !c.hidden)
      .map((c) => attrsKeyOf(c.source))
      .filter((k): k is string => k !== null),
  );
  return effectiveSortKey(normalizeSortKey(requested), visibleAttrsKeys);
}

/**
 * 기본 정렬 열 지정 — `index` 열을 켜고 나머지는 푼다(한 열만). null 이면 전부 푼다.
 * 꺼진 열에는 필드를 남기지 않아 스킴 JSON 을 깨끗하게 유지한다.
 */
export function assignDefaultSort(
  columns: readonly ContactColumnDef[],
  index: number | null,
): ContactColumnDef[] {
  const target = index != null ? columns[index] : undefined;
  if (index != null && (!target || !canBeDefaultSort(target))) return [...columns];
  return columns.map((c, i) => {
    const { defaultSort: _drop, ...rest } = c;
    return i === index ? { ...rest, defaultSort: true } : rest;
  });
}

/** 저장 가드 — 문제가 있으면 사용자에게 보일 문구, 없으면 null. */
export function validateDefaultSort(columns: readonly ContactColumnDef[]): string | null {
  const marked = columns.filter((c) => c.defaultSort !== undefined);
  if (marked.some((c) => c.defaultSort !== true)) return '기본 정렬 값이 올바르지 않습니다.';
  if (marked.some((c) => !canBeDefaultSort(c))) {
    return '기본 정렬은 명단 속성(attrs) 컬럼에만 지정할 수 있습니다.';
  }
  if (marked.length > 1) return '기본 정렬은 한 열에만 지정할 수 있습니다.';
  return null;
}

/**
 * 교체 업로드로 스킴을 다시 만들 때 이전 지정을 옮긴다.
 * 열 이름이 같고 여전히 일반 열일 때만 — 옮기지 않으면 재업로드 한 번에 목록이 조용히 시스템ID 순으로 돌아간다.
 */
export function carryOverDefaultSort(
  next: ContactColumnScheme,
  previous: Pick<ContactColumnScheme, 'columns'> | null | undefined,
): ContactColumnScheme {
  const prevColumns = previous?.columns;
  if (!Array.isArray(prevColumns)) return next;
  const prev = prevColumns.find((c) => c.defaultSort === true && canBeDefaultSort(c));
  if (!prev) return next;
  const index = next.columns.findIndex((c) => c.key === prev.key && canBeDefaultSort(c));
  if (index < 0) return next;
  return { ...next, columns: assignDefaultSort(next.columns, index) };
}
