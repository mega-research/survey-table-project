import type { PiiFieldType } from '@/lib/crypto/pii-fields';
import type { NumRange } from './range-list';

export type CombineOp = 'AND' | 'OR';
export type ConditionMode = 'idlist' | 'text' | 'exact' | 'enum' | 'boolean' | 'in' | 'any';

/**
 * 필터 한 조건. WHERE 조립(contacts-filter-sql)과 조건 산출(read-models)이 공유하므로
 * DB 를 모르는 이 모듈이 소유한다 — 어느 한쪽에 두면 다른 쪽이 역방향으로 끌어간다.
 */
export interface FilterCondition {
  source: string;
  mode: ConditionMode;
  value: string;
  ranges?: NumRange[];
  /** mode === 'exact' (pii.*) 일 때만 populated. 그 외는 undefined. 소비자는 null-check 필수. */
  blindIndex?: string;
  /** mode === 'in' (헤더 체크박스 필터) 일 때만 populated. 컬럼 내 OR 값 목록. */
  values?: string[];
  /** mode === 'any' (전체 컬럼 검색) 일 때만 populated. OR 로 전개할 하위 조건. */
  subConditions?: FilterCondition[];
}

export interface FilterClause {
  condition: FilterCondition;
  op: CombineOp | null;
}

/**
 * 필터 source 문자열 상수 — 진척 보고/조사 대상 모듈 모두 공유.
 * 새 source 추가 시 한 곳에서만 갱신하면 모든 분기/검증/UI 가 따라간다.
 */
export const FILTER_SOURCE = {
  /** 전체 컬럼 검색 — 표시 중인 attrs ILIKE + pii blindIndex exact 를 OR 로 전개. */
  ALL: 'system.all',
  RESID: 'system.resid',
  CONTACT_RESULT: 'system.contact_result',
  WEB: 'system.web',
  EMAIL: 'system.email_count',
  ATTRS_PREFIX: 'attrs.',
  PII_PREFIX: 'pii.',
} as const;

/**
 * web(응답 상태) 필터 값 어휘 — 표시(StatusPill)·정렬(responseStatusRankExpr)과 같은
 * 상태 축. 검색바 dropdown(value-widget)과 헤더 필터(header-filter-popover)가 공유.
 * 구 URL 의 'true'/'false'(respondedAt 이진)는 WEB_FILTER_VALUES 로만 계속 수용하고
 * UI 옵션에는 노출하지 않는다.
 */
export const WEB_FILTER_OPTIONS = [
  { value: 'completed', label: '응답 완료' },
  { value: 'in_progress', label: '진행 중' },
  { value: 'drop', label: '이탈' },
  { value: 'none', label: '미응답' },
] as const;

/** web 필터로 수용 가능한 전체 값 (신규 상태 어휘 + 레거시 'true'/'false'). */
export const WEB_FILTER_VALUES: ReadonlySet<string> = new Set([
  ...WEB_FILTER_OPTIONS.map((o) => o.value),
  'true',
  'false',
]);

/**
 * 메일(최신 수신 상태) 필터 값 어휘 — 순서가 곧 정렬 순위 축(잘된 순).
 * 라벨은 recipientStatusMeta(STATUS_LABEL)와 동일해야 한다 — 동기화는
 * 단위 테스트로 고정 (컴포넌트 → lib 역방향 import 를 피하기 위한 복제).
 * 'none' 은 발송 이력 없음 (latestMailStatus IS NULL).
 */
export const MAIL_FILTER_OPTIONS = [
  { value: 'opened', label: '열람' },
  { value: 'delivered', label: '전달 완료' },
  { value: 'sent', label: '발송됨' },
  { value: 'sending', label: '전송중' },
  { value: 'queued', label: '대기' },
  { value: 'skipped_unsubscribed', label: '수신거부' },
  { value: 'bounced', label: '반송' },
  { value: 'complained', label: '신고' },
  { value: 'failed', label: '실패' },
  { value: 'none', label: '메일 없음' },
] as const;

/** 메일 필터로 수용 가능한 전체 값. */
export const MAIL_FILTER_VALUES: ReadonlySet<string> = new Set(
  MAIL_FILTER_OPTIONS.map((o) => o.value),
);

/**
 * 현재 걸린 값 기준 web 필터 선택지 — 레거시 값('true'/'false', 구 URL·캠페인
 * 스냅샷 재발송 경유)이 있으면 실제 서버 의미 그대로 라벨링해 함께 노출한다.
 * 레거시를 새 옵션('미응답' 등)으로 위장 표시하면 화면과 실제 대상 집합이
 * 어긋난다 — 'false' 는 미완료 전체(진행중·이탈 포함)라 '미응답'보다 넓다.
 * 검색바(value-widget)와 헤더 필터(header-filter-popover)가 공유.
 */
export function webFilterOptionsFor(
  current: Iterable<string>,
): Array<{ value: string; label: string }> {
  const cur = new Set(current);
  return [
    ...(cur.has('true') ? [{ value: 'true', label: '응답 완료 · 구필터' }] : []),
    ...(cur.has('false')
      ? [{ value: 'false', label: '미완료 · 구필터 — 진행중·이탈 포함' }]
      : []),
    ...WEB_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
  ];
}

/**
 * 헤더 필터(hv 파라미터)에서 in 모드 값 목록을 조인하는 구분자.
 * unit separator — 엑셀 셀 텍스트에 등장할 가능성이 사실상 없는 제어 문자.
 * 클라이언트(드롭다운 직렬화)와 서버(parseHeaderFiltersFromUrl)가 공유한다.
 */
export const HEADER_FILTER_VALUE_SEPARATOR = '\u001f';

/** 헤더 필터 URL hm 파라미터가 가질 수 있는 모드. */
export const HEADER_FILTER_MODES = ['in', 'text', 'exact'] as const;
export type HeaderFilterMode = (typeof HEADER_FILTER_MODES)[number];

/**
 * ILIKE wildcard escape — `%` `_` `\` 를 리터럴로 처리.
 * profiles.server.ts / report-progress.server.ts / contacts.server.ts 가 공유.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * source 종류 → input placeholder 텍스트.
 *
 * @param attrsLabel attrs.* 등 텍스트 매칭 컬럼의 placeholder. 진척 보고는 '부분일치',
 *                   조사 대상 기본값은 범위 검색 힌트 포함 (NO 등 숫자 컬럼 범위 검색 안내).
 */
export function placeholderFor(
  source: string | null,
  attrsLabel = '검색어 또는 범위 (예: 10-13)',
): string {
  if (!source) return '검색어';
  if (source === FILTER_SOURCE.ALL) return '전체 검색 (암호화 컬럼은 전문 일치)';
  if (source === FILTER_SOURCE.RESID) return '예: 1-30, 45';
  if (source.startsWith(FILTER_SOURCE.PII_PREFIX)) return '정확한 값 입력 (부분 검색 불가)';
  return attrsLabel;
}

/** 필터 컬럼 후보 기본 타입 — client 컴포넌트가 사용. */
export interface ColumnCandidate {
  source: string;
  label: string;
  /**
   * 컬럼 스킴에서 숨김 처리된 컬럼. 드롭다운에서 명시 선택하면 검색 가능하지만
   * 전체(system.all) 검색 전개에서는 제외 — 보이지 않는 컬럼에서의 매칭은
   * 사용자가 이유를 알 수 없기 때문.
   */
  hidden?: boolean;
}

/** 서버 모듈에서 pii blindIndex 계산을 위해 piiType 포함. */
export interface ColumnCandidateWithPii extends ColumnCandidate {
  piiType?: PiiFieldType;
}
