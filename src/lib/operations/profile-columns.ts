// 응답 내역(profiles) 표시 컬럼 스킴 헬퍼 — 클라이언트(에디터)·서버(페이지) 공용, server-only 금지.
import type {
  ContactColumnScheme,
  ProfileColumnDef,
  ProfileColumnScheme,
} from '@/db/schema/schema-types';
import { RESID_DEFAULT_LABEL } from '@/lib/operations/contacts';

const ATTRS_PREFIX = 'attrs.';
const PII_PREFIX = 'pii.';

interface SysColumnDef {
  key: string;
  label: string;
  /** 스킴 미저장 시 기본 숨김 (ipHash 는 opt-in) */
  defaultHidden?: boolean;
}

/** 시스템 컬럼 풀 — 기존 응답 내역 테이블 9컬럼 + ipHash(기본 숨김). 순서가 기본 순서. */
export const PROFILE_SYS_COLUMNS: readonly SysColumnDef[] = [
  { key: 'sys.idx', label: '순번' },
  { key: 'sys.resid', label: RESID_DEFAULT_LABEL },
  { key: 'sys.group', label: '조사 대상 그룹' },
  { key: 'sys.platform', label: '접속 단말' },
  { key: 'sys.browser', label: '브라우저' },
  { key: 'sys.status', label: '상태' },
  { key: 'sys.startedAt', label: '시작일시' },
  { key: 'sys.completedAt', label: '종료일시' },
  { key: 'sys.totalSeconds', label: '소요시간' },
  { key: 'sys.ipHash', label: 'IP 해시', defaultHidden: true },
];

/**
 * 시스템 컬럼 풀 + 컨택 스킴(attrs/pii) 풀 + 저장 스킴 머지.
 *
 * - 풀 순서: sys 고정 세트 → 컨택 스킴 attrs./pii. (컨택 order 정렬).
 * - 저장 스킴에 같은 key 가 있으면 저장값(label/order/hidden)이 이긴다.
 * - 미저장 key 는 sys 는 defaultHidden, attrs/pii 는 hidden=true 로 시작.
 * - 컨택 스킴에서 사라진 attrs/pii 고아 key 는 결과에서 제거 → save 시 자동 정리.
 */
export function hydrateProfileColumns(
  contactScheme: ContactColumnScheme | null,
  savedScheme: ProfileColumnScheme | null,
): ProfileColumnDef[] {
  const residLabel =
    contactScheme?.columns.find((c) => c.source === 'system.resid')?.label?.trim() ||
    RESID_DEFAULT_LABEL;

  const contactPool = (contactScheme?.columns ?? [])
    .filter((c) => c.source.startsWith(ATTRS_PREFIX) || c.source.startsWith(PII_PREFIX))
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ key: c.source, label: c.label, defaultHidden: true }));

  const pool = [
    ...PROFILE_SYS_COLUMNS.map((c) =>
      c.key === 'sys.resid' ? { ...c, label: residLabel } : c,
    ),
    ...contactPool,
  ];

  const existingMap = new Map((savedScheme?.columns ?? []).map((c) => [c.key, c]));

  const merged = pool.map((p, i): ProfileColumnDef => {
    const existing = existingMap.get(p.key);
    if (existing) return existing;
    return {
      key: p.key,
      label: p.label,
      order: i,
      ...(p.defaultHidden ? { hidden: true } : {}),
    };
  });

  return merged.sort((a, b) => a.order - b.order);
}

/** 표시 컬럼만 order 순으로. */
export function visibleProfileColumns(columns: ProfileColumnDef[]): ProfileColumnDef[] {
  return columns
    .filter((c) => !c.hidden)
    .slice()
    .sort((a, b) => a.order - b.order);
}

/** ipHash 표시 자릿수 — 전체 해시는 노출하지 않는다. */
export const IP_HASH_DISPLAY_LEN = 8;

export function formatIpHash(hash: string | null): string {
  if (!hash) return '—';
  return hash.slice(0, IP_HASH_DISPLAY_LEN);
}
