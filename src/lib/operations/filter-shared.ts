import type { PiiFieldType } from '@/lib/crypto/pii-fields';

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
 *
 * 종결 상태 3종(screened_out/quotaful_out/bad)의 라벨은 응답 내역 표
 * (mapStatusPill · profiles 필터)와 같은 문자열이어야 한다 — 같은 상태를 두 화면이
 * 다르게 부르면 운영자가 서로 다른 축으로 착각한다.
 * 유일한 예외는 엑셀 export(rawdata·조사 대상) — formatExportStatusLabel 이
 * 자격 미달을 완료 계열("완료(자격 미달)")로 표기한다.
 */
export const WEB_FILTER_OPTIONS = [
  { value: 'completed', label: '응답 완료' },
  { value: 'in_progress', label: '진행 중' },
  { value: 'drop', label: '이탈' },
  { value: 'screened_out', label: '자격 미달' },
  { value: 'quotaful_out', label: '쿼터마감' },
  { value: 'bad', label: '불량' },
  { value: 'none', label: '미응답' },
] as const;

/** web 필터로 수용 가능한 전체 값 (신규 상태 어휘 + 레거시 'true'/'false'). */
export const WEB_FILTER_VALUES: ReadonlySet<string> = new Set([
  ...WEB_FILTER_OPTIONS.map((o) => o.value),
  'true',
  'false',
]);

/**
 * "값 없음"(NULL / 미기록) 을 체크박스 한 줄로 표현하기 위한 센티널.
 * 컨택결과·수신자 그룹·반송 사유처럼 값 공간이 사용자 자유 텍스트라 in-band 충돌이
 * 원리상 가능한 축에서 쓴다 — 그래서 값 자체를 SQL 로 흘리지 않고, 파서가 이 문자열을
 * 별도 플래그(또는 IS NULL 분기)로 승격시킨다.
 *
 * 충돌 규칙은 "센티널이 항상 이긴다" 하나뿐이다. 실제 값이 이 문자열과 같으면 그 값을
 * 선택지에서 빼고(withNoneOption / facets / attrs distinct), 파서는 예외 없이 빈 값으로
 * 해석한다. 값 쪽을 살리려면 UI·파서·SQL 세 층이 같은 예외를 알아야 하는데 파서는
 * attrs 의 실제 값 목록을 모르므로 그 규칙은 구현이 불가능하다 — 한 층만 예외를 알면
 * 화면에서 고른 것과 실제로 걸리는 행이 갈라진다.
 */
export const FILTER_NONE_VALUE = '__none__';

/**
 * 빈 값 선택지의 공용 라벨 — 표에서 그 행이 실제로 어떻게 보이는지(대시)를 그대로 쓴다.
 * 컬럼마다 "결과 없음"·"발송 안 함"처럼 다른 말을 쓰면 같은 개념을 매번 다시 배워야 하고,
 * 화면의 '—' 와 필터 문구가 연결되지 않는다.
 */
export const FILTER_NONE_LABEL = '— (없음)';

/** 입력형 컬럼(pii·고카디널리티 attrs)의 빈 값 토글 라벨. 체크박스 목록 항목의 짝. */
export const FILTER_NONE_TOGGLE_LABEL = '— 인 것만 보기';

/**
 * FILTER_NONE_VALUE 의 여집합 센티널 — "값이 있는 행만"(빈 값 제외).
 * 같은 "센티널이 항상 이긴다" 규칙을 따르지만, 이 값은 체크박스 목록에는 절대
 * 오르지 않고 입력형 컬럼(pii·고카디널리티 attrs)의 토글에서 단독으로만 생성된다 —
 * 그래서 파서도 단독 값일 때만 센티널로 해석한다.
 */
export const FILTER_NOT_NONE_VALUE = '__not_none__';

/** 입력형 컬럼의 빈 값 제외 토글 라벨. FILTER_NONE_TOGGLE_LABEL 의 짝. */
export const FILTER_NOT_NONE_TOGGLE_LABEL = '— 제외하고 보기';

/**
 * 선택지 목록 끝에 빈 값 항목을 덧붙인다.
 * 센티널과 같은 실제 값은 제거한다 — 남겨두면 파서가 그것도 빈 값으로 해석해
 * 사용자가 고른 값과 다른 행이 걸린다.
 */
export function withNoneOption(
  options: Array<{ value: string; label: string }>,
  noneLabel: string = FILTER_NONE_LABEL,
): Array<{ value: string; label: string }> {
  return [
    ...options.filter((o) => o.value !== FILTER_NONE_VALUE),
    { value: FILTER_NONE_VALUE, label: noneLabel },
  ];
}

/**
 * 컨택결과 드롭다운/체크박스 선택지 — 등록 결과코드 + "결과 없음".
 * 검색바(value-widget)와 헤더 필터(header-filter-popover)가 공유한다.
 */
export function contactResultFilterOptions(
  resultCodes: ReadonlyArray<{ code: string; label: string }>,
): Array<{ value: string; label: string }> {
  return withNoneOption(resultCodes.map((rc) => ({ value: rc.code, label: rc.label })));
}

/**
 * 단체 메일 수신자 목록 전용 깔때기 source. 컨택 절 파이프라인(FILTER_SOURCE)과
 * 별개 축이다 — mail_recipients 발송 스냅샷 위에서만 의미가 있고, 서버도 전용
 * 파서로 좁게 해석한다. 라벨은 표 헤더와 같은 문구.
 */
export const RECIPIENT_FILTER_SOURCE = {
  /** contact_targets.group_value */
  GROUP: 'recipient.group',
  /** mail_recipients.error_reason — 표에서는 "메모" 로 노출 */
  ERROR: 'recipient.error',
  /** 컨택 최신 회차 result_code */
  RESULT: 'recipient.result',
} as const;

export const RECIPIENT_FILTER_LABEL: Record<string, string> = {
  [RECIPIENT_FILTER_SOURCE.GROUP]: '그룹',
  [RECIPIENT_FILTER_SOURCE.ERROR]: '메모',
  [RECIPIENT_FILTER_SOURCE.RESULT]: '최근 결과코드',
};

/**
 * 메일(최신 수신 상태) 필터 값 어휘 — 순서가 곧 정렬 순위 축(잘된 순).
 * 라벨은 recipientStatusMeta(STATUS_LABEL)와 동일해야 한다 — 동기화는
 * 단위 테스트로 고정 (컴포넌트 → lib 역방향 import 를 피하기 위한 복제).
 * 'none' 은 발송 이력 없음 (latestMailStatus IS NULL) — 라벨은 FILTER_NONE_LABEL 공용.
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
  // 발송 이력이 한 건도 없는 컨택 (latestMailStatus IS NULL).
  { value: 'none', label: FILTER_NONE_LABEL },
] as const;

/** 메일 필터로 수용 가능한 전체 값. */
export const MAIL_FILTER_VALUES: ReadonlySet<string> = new Set(
  MAIL_FILTER_OPTIONS.map((o) => o.value),
);

/**
 * 최근 결과코드명이 이 문자열을 포함하면 수신거부로 판정 — 조사 대상의
 * 유효 메일 상태(effectiveMailStatusExpr — 표시·필터·정렬 공유)가 쓰는
 * 단일 기준. 컨택 회차에서 수동 기록된 수신거부(예: "13.수신거부")를 메일
 * unsubscribed_at 과 같은 축으로 취급한다.
 */
export const UNSUBSCRIBE_RESULT_CODE_KEYWORD = '수신거부';

/** 결과코드가 수신거부 판정인지 — SQL 조립 분기·badge 표시가 공유하는 판정. */
export function isUnsubscribeResultCode(code: string | null | undefined): boolean {
  return code != null && code.includes(UNSUBSCRIBE_RESULT_CODE_KEYWORD);
}

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
 *                   조사 대상 기본값은 숫자 검색 힌트 포함 (연번 등 숫자 컬럼 안내 —
 *                   숫자만 입력하면 그 숫자인 값만, 범위/목록도 숫자 매칭).
 */
export function placeholderFor(
  source: string | null,
  attrsLabel = '검색어 또는 번호 (예: 3, 1-10) · 엑셀 열 붙여넣기',
): string {
  if (!source) return '검색어';
  if (source === FILTER_SOURCE.ALL) return '전체 검색 (암호화 컬럼은 전문 일치)';
  if (source === FILTER_SOURCE.RESID) return '예: 1-30, 45 · 엑셀 열 붙여넣기';
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

/**
 * 단체 메일 마법사 미리보기 표의 깔때기 필터 컬럼 — 표가 고정 컬럼이라 후보도
 * 컨택 컬럼 스킴과 무관하게 고정한다 (스킴에서 system.* 컬럼을 지워도 마법사
 * 필터는 살아 있어야 한다). label 은 표 헤더와 같은 문구를 쓴다.
 * 페이지(서버 파싱 후보)와 마법사(헤더 렌더)가 이 한 목록을 공유한다.
 */
export const CAMPAIGN_HEADER_FILTER_COLUMNS: ReadonlyArray<ColumnCandidate> = [
  { source: FILTER_SOURCE.WEB, label: '응답' },
  { source: FILTER_SOURCE.EMAIL, label: '수신 상황' },
  { source: FILTER_SOURCE.CONTACT_RESULT, label: '최근 결과코드' },
];

/** 서버 모듈에서 pii blindIndex 계산을 위해 piiType 포함. */
export interface ColumnCandidateWithPii extends ColumnCandidate {
  piiType?: PiiFieldType;
}

// ─────────── 저장된 ID 목록 참조 토큰 ───────────

/**
 * 단일 컬럼 인라인 상한(SINGLE_COLUMN_ID_LIST_MAX)을 넘는 붙여넣기 목록은 서버에 저장하고
 * URL 에는 `list:<uuid>[:<count>]` 토큰만 싣는다. count 는 위젯 표시용이며 서버는
 * uuid 만 본다 (검색·뒤로가기·캠페인 스냅샷 재현이 전부 URL 그대로 동작).
 */
const ID_LIST_TOKEN_PREFIX = 'list:';

const ID_LIST_TOKEN_REGEX = new RegExp(
  `^${ID_LIST_TOKEN_PREFIX}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::(\\d+))?$`,
  'i',
);

export interface IdListToken {
  /** contact_id_lists.id */
  id: string;
  /** 표시용 개수 (토큰에 없으면 null) */
  count: number | null;
}

export function parseIdListToken(value: string): IdListToken | null {
  const m = ID_LIST_TOKEN_REGEX.exec(value.trim());
  if (!m || m[1] === undefined) return null;
  return { id: m[1].toLowerCase(), count: m[2] !== undefined ? Number(m[2]) : null };
}

export function formatIdListToken(id: string, count: number): string {
  return `${ID_LIST_TOKEN_PREFIX}${id}:${count}`;
}
