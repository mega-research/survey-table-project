// 응답 내역(profiles) 표시 컬럼 스킴 헬퍼 — 클라이언트(에디터)·서버(페이지) 공용, server-only 금지.
import { RESID_DEFAULT_LABEL, attrsKeyOf, piiKeyOf } from '@/lib/operations/contacts-format';
import type {
  NormalizedContactColumnScheme,
  RawExportContactColumn,
} from '@/lib/operations/contacts-format';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import type { ProfileColumnDef, ProfileColumnScheme } from '@/shared/contracts/operations';

const ATTRS_PREFIX = 'attrs.';
const PII_PREFIX = 'pii.';
const ENTRY_PREFIX = 'entry.';
const ANSWER_PREFIX = FILTER_SOURCE.ANSWER_PREFIX;

/**
 * 응답값 열 키 — 문항 하나의 응답(`answer.<문항 id>`) 또는 표 문항의 칸 하나
 * (`answer.<문항 id>.<칸 id>`). 변수명(Q1_r1_c2)은 문항코드·행 순서로 매번 다시 만들어지는
 * 이름이라 저장하지 않고, 바뀌지 않는 id 로 가리킨다.
 */
export function answerColumnKey(questionId: string, cellId?: string | null): string {
  return cellId ? `${ANSWER_PREFIX}${questionId}.${cellId}` : `${ANSWER_PREFIX}${questionId}`;
}

/** `answer.<문항 id>[.<칸 id>]` 이면 그 id 들, 아니면 null. */
export function answerKeyOf(key: string): { questionId: string; cellId: string | null } | null {
  if (!key.startsWith(ANSWER_PREFIX)) return null;
  const rest = key.slice(ANSWER_PREFIX.length);
  const dot = rest.indexOf('.');
  const questionId = dot === -1 ? rest : rest.slice(0, dot);
  const cellId = dot === -1 ? null : rest.slice(dot + 1);
  if (!questionId || cellId === '') return null;
  return { questionId, cellId };
}

/** 이어 넘길 값 열 키 — 종료 후 이동 주소 설정의 passParams 이름마다 하나(`entry.euid`). */
export function entryColumnKey(name: string): string {
  return `${ENTRY_PREFIX}${name}`;
}

/** `entry.<name>` 이면 name, 아니면 null. */
export function entryKeyOf(key: string): string | null {
  return key.startsWith(ENTRY_PREFIX) ? key.slice(ENTRY_PREFIX.length) : null;
}

/**
 * 응답 경로 — 그 응답이 조사 대상의 개별 링크로 들어왔는가(`invite`), 공개 링크로 들어왔는가(`public`).
 * 따로 저장하는 값이 아니라 응답이 조사 대상과 이어져 있는가로 판정한다(시스템ID 열과 같은 기준).
 * 그래서 명단을 지워 연결이 끊긴 응답은 공개 링크로 보인다.
 */
export const RESPONSE_LINK_TYPES = ['invite', 'public'] as const;
export type ResponseLinkType = (typeof RESPONSE_LINK_TYPES)[number];

export const RESPONSE_LINK_TYPE_LABELS: Record<ResponseLinkType, string> = {
  invite: '개별링크',
  public: '공개링크',
};

/** 응답 경로 열의 헤더 깔때기 source (`hcol`) — 열 키는 `sys.linkType`. */
export const LINK_TYPE_FILTER_SOURCE = 'linkType';

export function responseLinkTypeOf(row: { contactTargetId: string | null }): ResponseLinkType {
  return row.contactTargetId === null ? 'public' : 'invite';
}

/**
 * 「조사 대상 그룹」 칸의 글자 — 그룹 값(명단 대분류). 값이 없을 때 공개 링크 응답만 「공개링크」로 적고,
 * 조사 대상과 이어진 응답은 null(화면 「—」· 엑셀 빈칸)이다. 전에는 그룹 값이 없으면 전부 「공개링크」라
 * 대분류 없이 올린 명단·한 명씩 추가한 대상의 개별 링크 응답까지 공개 링크로 읽혔다.
 */
export function profileGroupText(row: {
  groupValue: string | null;
  contactTargetId: string | null;
}): string | null {
  if (row.groupValue !== null) return row.groupValue;
  return row.contactTargetId === null ? RESPONSE_LINK_TYPE_LABELS.public : null;
}

interface SysColumnDef {
  key: string;
  label: string;
  /** 스킴 미저장 시 기본 숨김 (ipHash 는 opt-in) */
  defaultHidden?: boolean;
}

/**
 * 시스템 컬럼 풀 — 기존 응답 내역 테이블 9컬럼 + 응답 경로 + ipHash(기본 숨김). 순서가 기본 순서.
 * 시스템ID·응답 경로 열은 조사 대상이 있는 설문에만 그린다(화면·엑셀이 각자 hasContacts 로 뺀다).
 */
export const PROFILE_SYS_COLUMNS: readonly SysColumnDef[] = [
  { key: 'sys.idx', label: '순번' },
  { key: 'sys.resid', label: RESID_DEFAULT_LABEL },
  { key: 'sys.group', label: '조사 대상 그룹' },
  { key: 'sys.linkType', label: '응답 경로' },
  { key: 'sys.platform', label: '접속 단말' },
  { key: 'sys.browser', label: '브라우저' },
  { key: 'sys.status', label: '상태' },
  { key: 'sys.startedAt', label: '시작일시' },
  { key: 'sys.completedAt', label: '종료일시' },
  { key: 'sys.totalSeconds', label: '소요시간' },
  { key: 'sys.ipHash', label: 'IP 해시', defaultHidden: true },
];

/**
 * 시스템 컬럼 풀 + 이어 넘길 값 풀 + 컨택 스킴(attrs/pii) 풀 + 저장 스킴 머지.
 *
 * - 풀 순서: sys 고정 세트 → 이어 넘길 값 entry. (설정 순서) → 컨택 스킴 attrs./pii. (컨택 order 정렬).
 * - 저장 스킴에 같은 key 가 있으면 저장값(label/order/hidden)이 이긴다.
 * - 미저장 key 는 sys 는 defaultHidden, entry 는 보임(패널 회원 ID 를 받겠다고 설정했으면 볼
 *   값이다), attrs/pii 는 hidden=true 로 시작.
 * - 응답값 열(answer.)은 풀에 없다 — 컬럼 설정에서 추가한 저장 열만 answerColumnKeys 로 걸러 잇는다.
 * - 컨택 스킴·이어 넘길 값 설정에서 사라진 고아 key 는 결과에서 제거 → save 시 자동 정리.
 */
export function hydrateProfileColumns(
  contactScheme: NormalizedContactColumnScheme | null,
  savedScheme: ProfileColumnScheme | null,
  /** 종료 후 이동 주소 설정의 passParams(normalizePassParamNames 결과). */
  entryParamNames: readonly string[] = [],
  /**
   * 지금 설문 구조에 있는 응답값 열 키. 저장 스킴의 answer.* 열은 여기 있는 것만 남는다 —
   * 문항·칸이 지워지면 열도 빠진다. 넘기지 않으면 answer.* 열을 전부 뺀다(명단 열만 보는 호출부).
   */
  answerColumnKeys: ReadonlySet<string> = new Set(),
): ProfileColumnDef[] {
  const residLabel =
    contactScheme?.columns.find((c) => c.source === 'system.resid')?.label?.trim() ||
    RESID_DEFAULT_LABEL;

  const contactPool = (contactScheme?.columns ?? [])
    .filter((c) => c.source.startsWith(ATTRS_PREFIX) || c.source.startsWith(PII_PREFIX))
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ key: c.source, label: c.label, defaultHidden: true }));

  const entryPool = entryParamNames.map((name) => ({ key: entryColumnKey(name), label: name }));

  const pool: SysColumnDef[] = [
    ...PROFILE_SYS_COLUMNS.map((c) => (c.key === 'sys.resid' ? { ...c, label: residLabel } : c)),
    ...entryPool,
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

  // 응답값 열은 풀이 아니라 사람이 골라 추가한 것만 있다 — 저장 스킴에서 지금 구조에 있는 것만 잇는다.
  const answerColumns = (savedScheme?.columns ?? []).filter(
    (c) => answerKeyOf(c.key) !== null && answerColumnKeys.has(c.key),
  );

  return [...merged, ...answerColumns].sort((a, b) => a.order - b.order);
}

/** 표시 컬럼만 order 순으로. */
export function visibleProfileColumns(columns: ProfileColumnDef[]): ProfileColumnDef[] {
  return columns
    .filter((c) => !c.hidden)
    .slice()
    .sort((a, b) => a.order - b.order);
}

/**
 * 고객 계정(보기 전용 게스트)에 내지 않는 시스템 열 — 시작일시·소요시간. 종료일시는 남는다.
 * 소요시간이 짧은 응답을 빼 달라는 요구가 고객에게서 나와 화면과 내려받는 목록 양쪽에서 뺐다
 * (2026-11-17 사용자 결정). 관리자가 컬럼 설정에서 켜 둔 열이라도 고객 계정에는 나가지 않는다.
 */
const CLIENT_HIDDEN_PROFILE_COLUMN_KEYS: ReadonlySet<string> = new Set([
  'sys.startedAt',
  'sys.totalSeconds',
]);

/** 고객 계정에 보일 열 — 시작일시·소요시간을 뺀다. 나머지 순서는 그대로다. */
export function withoutClientHiddenProfileColumns<T extends { key: string }>(
  columns: readonly T[],
): T[] {
  return columns.filter((c) => !CLIENT_HIDDEN_PROFILE_COLUMN_KEYS.has(c.key));
}

/**
 * 고객 계정이 고른 정렬이 감춘 열(시작일시·소요시간)이면 기본 정렬(순번)로 돌린다 —
 * 보이지 않는 값으로 줄을 세우면 주소만 고쳐 짧은 응답부터 늘어놓을 수 있다.
 */
export function clientVisibleProfileSort<T extends string>(sort: T): T | 'idx' {
  return CLIENT_HIDDEN_PROFILE_COLUMN_KEYS.has(`sys.${sort}`) ? 'idx' : sort;
}

/**
 * 고객 계정 화면에 넘길 행 — 시작일시·소요시간 값을 비운다. 열만 빼면 값은 화면 데이터에 실려
 * 브라우저까지 간다.
 */
export function withoutClientHiddenProfileTimings<
  T extends { startedAt: Date | null; totalSeconds: number | null },
>(rows: readonly T[]): T[] {
  return rows.map((r) => ({ ...r, startedAt: null, totalSeconds: null }));
}

/** ipHash 표시 자릿수 — 전체 해시는 노출하지 않는다. */
export const IP_HASH_DISPLAY_LEN = 8;

export function formatIpHash(hash: string | null): string {
  if (!hash) return '—';
  return hash.slice(0, IP_HASH_DISPLAY_LEN);
}

/**
 * 이어 넘길 값(패널 회원 ID) 표시 자릿수 — UUID 첫 마디만큼만 보이고 나머지는 말줄임.
 * IP 해시와 달리 값을 감출 이유는 없어 전체 값은 title·복사로 꺼낼 수 있게 화면에 둔다.
 */
export const ENTRY_PARAM_DISPLAY_LEN = 8;

/**
 * Raw 내보내기에 붙일 조사 대상 명단 열 — 응답 내역 컬럼 설정에서 **표시 중인** attrs.*·pii.* 열만,
 * 설정 순서대로. 숨긴 열은 엑셀에도 없고 sys.* 열은 엑셀 고정 메타 열이 이미 갖고 있어 뺀다.
 * 컬럼 설정이 저장된 적 없으면 attrs/pii 는 기본 숨김이라 빈 배열이다. 컨택 스킴에서 사라진
 * 고아 key 는 hydrate 가 걸러낸다.
 */
export function selectRawExportContactColumns(
  contactScheme: NormalizedContactColumnScheme | null,
  profileScheme: ProfileColumnScheme | null,
): RawExportContactColumn[] {
  const out: RawExportContactColumn[] = [];
  for (const c of visibleProfileColumns(hydrateProfileColumns(contactScheme, profileScheme))) {
    const attrsKey = attrsKeyOf(c.key);
    const piiKey = piiKeyOf(c.key);
    const label = c.label.trim() || (attrsKey ?? piiKey ?? c.key);
    if (attrsKey !== null) {
      out.push({ source: c.key, label, kind: 'attrs', key: attrsKey });
    } else if (piiKey !== null) {
      out.push({ source: c.key, label, kind: 'pii', key: piiKey });
    }
  }
  return out;
}
